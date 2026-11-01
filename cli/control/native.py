"""Optional semantic accessibility adapter. No screenshots or arbitrary commands.
macOS: PyObjC Quartz/AppKit/ApplicationServices; Linux X11: PyGObject AT-SPI and pynput.
Wayland control is deliberately unavailable without a supported compositor remote-desktop portal.
"""
import sys, os, json, threading
active=False
interrupted=False
nodes={}
root_window=None
lock=threading.Lock()
def emit(value):
    with lock:
        print(json.dumps(value),flush=True)
def stop(*args):
    global interrupted,active
    if active:
        interrupted=True
        active=False
        emit({"event":"manualInput"})
def check():
    if interrupted:
        raise RuntimeError("Manual input/emergency stop; action stopped")
def clean(value,limit=2000):
    return str(value or "")[:limit]
class Mac:
    def __init__(self,listen):
        import Quartz as Q, AppKit as A, ApplicationServices as AX, CoreFoundation as CF
        self.Q,self.A,self.AX,self.CF=Q,A,AX,CF
        self.ready=False
        if not AX.AXIsProcessTrusted():
            raise RuntimeError("Accessibility permission missing. Enable only after user review in System Settings; TIM does not change it.")
        if listen:
            def callback(proxy,event_type,event,ref):
                if event_type in [Q.kCGEventTapDisabledByTimeout,Q.kCGEventTapDisabledByUserInput]:
                    self.ready=False
                stop()
                return event
            self.callback=callback
            mask=sum(1<<n for n in [Q.kCGEventKeyDown,Q.kCGEventMouseMoved,Q.kCGEventLeftMouseDown,Q.kCGEventRightMouseDown])
            self.tap=Q.CGEventTapCreate(Q.kCGSessionEventTap,Q.kCGHeadInsertEventTap,Q.kCGEventTapOptionListenOnly,mask,callback,None)
            if self.tap is None:
                raise RuntimeError("Input-monitoring event tap unavailable; control disabled.")
            def events():
                source=CF.CFMachPortCreateRunLoopSource(None,self.tap,0)
                CF.CFRunLoopAddSource(CF.CFRunLoopGetCurrent(),source,CF.kCFRunLoopCommonModes)
                Q.CGEventTapEnable(self.tap,True)
                self.ready=True
                CF.CFRunLoopRun()
            threading.Thread(target=events,daemon=True).start()
        else:
            self.ready=False
    def attr(self,node,name,default=None):
        err,value=self.AX.AXUIElementCopyAttributeValue(node,name,None)
        return value if err==0 else default
    def observe(self,pid):
        global nodes,root_window
        app=self.AX.AXUIElementCreateApplication(pid)
        windows=self.attr(app,"AXWindows",[])
        if not windows: raise RuntimeError("No accessible window for target PID")
        root=windows[0]
        root_window=str(pid)+":"+str(hash(root))
        queue=[("ax:0",root)]; nodes={}; result=[]
        while queue and len(result)<200:
            identifier,node=queue.pop(0)
            role=self.attr(node,"AXRole","")
            if self.attr(node,"AXSubrole","")=="AXSecureTextField": continue
            enabled=bool(self.attr(node,"AXEnabled",True))
            err,writable=self.AX.AXUIElementIsAttributeSettable(node,"AXValue",None)
            err_action,actions=self.AX.AXUIElementCopyActionNames(node,None)
            allowed=[]
            if err==0 and writable and role in ["AXTextField","AXTextArea"]: allowed.append("set_value")
            if err_action==0 and "AXPress" in (actions or []): allowed.append("invoke")
            value=self.attr(node,"AXValue","")
            if not isinstance(value,(str,int,float,bool)): value=""
            nodes[identifier]=node
            result.append(dict(id=identifier,name=clean(self.attr(node,"AXTitle",self.attr(node,"AXDescription","")),500),role=clean(role,80),enabled=enabled,value=clean(value),risk="unclassified",actions=allowed))
            for index,child in enumerate(self.attr(node,"AXChildren",[])[:200-len(result)-len(queue)]):
                queue.append((identifier+"."+str(index),child))
        return dict(targetPid=pid,targetWindow=root_window,permissions=True,elements=result)
    def act(self,p):
        check()
        if hasattr(self,"tap") and not self.Q.CGEventTapIsEnabled(self.tap): raise RuntimeError("Input monitor unavailable; control stopped")
        if hasattr(self,"keys") and not (self.keys.is_alive() and self.mouse.is_alive()): raise RuntimeError("Input monitors disconnected; control stopped")
        if p["targetWindow"]!=root_window or p["elementId"] not in nodes: raise RuntimeError("Target binding changed")
        app=self.A.NSRunningApplication.runningApplicationWithProcessIdentifier_(p["targetPid"])
        if app is None or not app.activateWithOptions_(self.A.NSApplicationActivateIgnoringOtherApps): raise RuntimeError("Foreground activation refused")
        if self.A.NSWorkspace.sharedWorkspace().frontmostApplication().processIdentifier()!=p["targetPid"]: raise RuntimeError("Foreground target mismatch")
        node=nodes[p["elementId"]]
        if self.attr(node,"AXSubrole","")=="AXSecureTextField": raise RuntimeError("Secure field refused")
        if p["operation"]=="set_value":
            code=self.AX.AXUIElementSetAttributeValue(node,"AXValue",p["value"])
        elif p["operation"]=="invoke":
            code=self.AX.AXUIElementPerformAction(node,"AXPress")
        else: raise RuntimeError("Unsupported operation")
        check()
        if code!=0: raise RuntimeError("Accessibility action failed: "+str(code))
        return {"ok":True}
class Linux:
    def __init__(self,listen):
        if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE")=="wayland":
            raise RuntimeError("Wayland requires a compositor-approved remote desktop portal adapter; global takeover is unsupported and no X11 bypass is attempted.")
        if not os.environ.get("DISPLAY"): raise RuntimeError("No X11 display")
        import gi
        gi.require_version("Atspi","2.0")
        from gi.repository import Atspi, GLib
        self.api=Atspi
        Atspi.init()
        self.ready=False
        if listen:
            from pynput import keyboard, mouse
            self.keys=keyboard.Listener(on_press=stop)
            self.mouse=mouse.Listener(on_move=stop,on_click=stop,on_scroll=stop)
            self.keys.start();self.mouse.start();self.keys.wait();self.mouse.wait()
            self.ready=self.keys.is_alive() and self.mouse.is_alive()
            threading.Thread(target=GLib.MainLoop().run,daemon=True).start()
    def observe(self,pid):
        global nodes,root_window
        desktop=self.api.get_desktop(0)
        apps=[desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
        app=next((a for a in apps if a.get_process_id()==pid),None)
        if app is None: raise RuntimeError("Target application is not exposed through AT-SPI")
        root_window="atspi:"+str(pid)+":"+str(app.get_id())
        queue=[("atspi:0",app)];nodes={};result=[]
        while queue and len(result)<200:
            identifier,node=queue.pop(0)
            role=node.get_role_name()
            if "password" in role.lower(): continue
            state=node.get_state_set();enabled=state.contains(self.api.StateType.ENABLED)
            editable=node.get_editable_text_iface() if node.is_editable_text() else None;action=node.get_action_iface() if node.is_action() else None;text=node.get_text_iface() if node.is_text() else None
            allowed=[]
            if editable is not None: allowed.append("set_value")
            if action is not None and action.get_n_actions()>0: allowed.append("invoke")
            value=text.get_text(0,min(text.get_character_count(),2000)) if text is not None else ""
            nodes[identifier]=node
            result.append(dict(id=identifier,name=clean(node.get_name(),500),role=clean(role,80),enabled=enabled,value=clean(value),risk="unclassified",actions=allowed))
            for i in range(min(node.get_child_count(),200-len(result)-len(queue))):
                child=node.get_child_at_index(i)
                if child is not None: queue.append((identifier+"."+str(i),child))
        return dict(targetPid=pid,targetWindow=root_window,permissions=True,elements=result)
    def act(self,p):
        check()
        if p["targetWindow"]!=root_window or p["elementId"] not in nodes: raise RuntimeError("Target binding changed")
        node=nodes[p["elementId"]]
        if "password" in node.get_role_name().lower(): raise RuntimeError("Secure field refused")
        component=node.get_component_iface()
        if component is None or not component.grab_focus(): raise RuntimeError("Target focus unavailable")
        if p["operation"]=="set_value": ok=node.get_editable_text_iface().set_text_contents(p["value"])
        elif p["operation"]=="invoke": ok=node.get_action_iface().do_action(0)
        else: raise RuntimeError("Unsupported operation")
        check()
        if not ok: raise RuntimeError("AT-SPI action failed")
        return {"ok":True}
def main():
    global active,interrupted
    metadata="--capabilities" in sys.argv
    adapter=None;error=""
    try:
        adapter=(Mac if sys.platform=="darwin" else Linux if sys.platform.startswith("linux") else None)
        if adapter is None: raise RuntimeError("Use the compiled Windows UIA adapter on Windows")
        adapter=adapter(not metadata)
        if not metadata:
            import time
            for _ in range(50):
                if adapter.ready: break
                time.sleep(.02)
    except Exception as exc: error=clean(exc,1000);adapter=None
    capabilities=dict(semanticVersion=1,foregroundInput=bool(adapter and adapter.ready),emergencyStop=bool(adapter and adapter.ready),manualInputInterruption=bool(adapter and adapter.ready),platform=sys.platform,nativeTested=False,error=error,note="Any manual key/mouse event interrupts active control. No screenshots. Native validation pending.")
    if metadata: emit(capabilities);return
    for line in sys.stdin:
        request={};identifier=None
        try:
            if len(line)>16384: raise RuntimeError("Request too large")
            request=json.loads(line);identifier=request.get("id");method=request["method"];p=request.get("params",{})
            if method=="capabilities": result=capabilities
            elif method=="releaseAll": active=False;result=True
            elif adapter is None or not adapter.ready: raise RuntimeError(error or "Interruption monitoring unavailable")
            elif method=="observeSemantic": result=adapter.observe(int(p["targetPid"]))
            elif method=="actSemantic":
                if p.get("operation") not in ["set_value","invoke"] or len(p.get("value",""))>2000: raise RuntimeError("Invalid semantic action")
                active=True;interrupted=False
                try: result=adapter.act(p)
                finally: active=False
            else: raise RuntimeError("Unsupported RPC")
            emit(dict(id=identifier,result=result))
        except Exception as exc:
            active=False;emit(dict(id=identifier,error=clean(exc,1000)))
if __name__=="__main__":main()
