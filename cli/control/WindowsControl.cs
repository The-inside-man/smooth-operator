using System.Windows.Automation;
using System;using System.Collections.Generic;using System.Diagnostics;using System.Runtime.InteropServices;using System.Threading;using System.Web.Script.Serialization;
class TimWindowsControl {
 class Indicator:System.Windows.Forms.Form {
  public System.Windows.Forms.Label status;
  protected override bool ShowWithoutActivation {get{return true;}}
  protected override System.Windows.Forms.CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80;return p;}}
  public Indicator(){Text="TIM control";TopMost=true;ShowInTaskbar=false;FormBorderStyle=System.Windows.Forms.FormBorderStyle.FixedToolWindow;ClientSize=new System.Drawing.Size(330,75);StartPosition=System.Windows.Forms.FormStartPosition.Manual;Location=new System.Drawing.Point(20,20);status=new System.Windows.Forms.Label{Text="TIM CONTROL / awaiting approval",Dock=System.Windows.Forms.DockStyle.Top,Height=35};Controls.Add(status);var stop=new System.Windows.Forms.Button{Text="STOP / Ctrl+Alt+Esc",Dock=System.Windows.Forms.DockStyle.Bottom};stop.Click+=(o,e)=>{interrupted=true;active=false;Release();Emit(new {@event="emergencyStop"});};Controls.Add(stop);}
 }
 static Indicator indicator;static IntPtr approvedWindow=IntPtr.Zero;
 static void Status(string text){if(indicator!=null&&indicator.IsHandleCreated)indicator.BeginInvoke(new Action(()=>indicator.status.Text=text));}

 static JavaScriptSerializer json=new JavaScriptSerializer();static object outputLock=new object(),keyLock=new object();static volatile bool active=false,interrupted=false,mouseHeld=false;static HashSet<ushort> held=new HashSet<ushort>();static IntPtr keyboardHook,mouseHook;static HookProc keyboardProc=Keyboard,mouseProc=Mouse;
 delegate bool EnumProc(IntPtr hwnd,IntPtr data);delegate IntPtr HookProc(int code,IntPtr wParam,IntPtr lParam);
 [StructLayout(LayoutKind.Sequential)]struct RECT{public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)]struct POINT{public int X,Y;}
 [StructLayout(LayoutKind.Sequential)]struct KBD{public uint vk,scan,flags,time;public IntPtr extra;}
 [StructLayout(LayoutKind.Sequential)]struct MOUSE{public POINT pt;public uint data,flags,time;public IntPtr extra;}
 [StructLayout(LayoutKind.Sequential)]struct MSG{public IntPtr hwnd;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public POINT pt;}
 [StructLayout(LayoutKind.Sequential)]struct KEYINPUT{public ushort vk,scan;public uint flags,time;public IntPtr extra;}
 [StructLayout(LayoutKind.Sequential)]struct MOUSEINPUT{public int dx,dy;public uint data,flags,time;public IntPtr extra;}
 [StructLayout(LayoutKind.Explicit)]struct UNION{[FieldOffset(0)]public KEYINPUT key;[FieldOffset(0)]public MOUSEINPUT mouse;}
 [StructLayout(LayoutKind.Sequential)]struct INPUT{public uint type;public UNION value;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr hwnd,System.Text.StringBuilder text,int count);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll")]static extern uint SendInput(uint count,INPUT[] inputs,int size);
 [DllImport("user32.dll")]static extern IntPtr SetWindowsHookEx(int type,HookProc callback,IntPtr module,uint thread);
 [DllImport("user32.dll")]static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]static extern int GetMessage(out MSG message,IntPtr hwnd,uint min,uint max);
 [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandle(string name);
 static void Emit(object value){lock(outputLock){Console.WriteLine(json.Serialize(value));Console.Out.Flush();}}
 static void Interrupt(string kind){if(!active)return;interrupted=true;active=false;Release();Emit(new { @event=kind });}
 static IntPtr Keyboard(int code,IntPtr w,IntPtr l){if(code>=0){var info=(KBD)Marshal.PtrToStructure(l,typeof(KBD));if((info.flags&16)==0&&active){bool emergency=info.vk==27&&(GetAsyncKeyState(17)&0x8000)!=0&&(GetAsyncKeyState(18)&0x8000)!=0;Interrupt(emergency?"emergencyStop":"manualInput");}}return CallNextHookEx(keyboardHook,code,w,l);}
 static IntPtr Mouse(int code,IntPtr w,IntPtr l){if(code>=0){var info=(MOUSE)Marshal.PtrToStructure(l,typeof(MOUSE));if((info.flags&1)==0&&active)Interrupt("manualInput");}return CallNextHookEx(mouseHook,code,w,l);}
 static void Key(ushort vk,bool up,ushort scan=0,bool unicode=false){var input=new INPUT{type=1,value=new UNION{key=new KEYINPUT{vk=vk,scan=scan,flags=(up?2u:0u)|(unicode?4u:0u)}}};if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("OS rejected input; no elevation attempted.");if(!unicode)lock(keyLock){if(up)held.Remove(vk);else held.Add(vk);}}
 static void Release(){lock(keyLock){foreach(var vk in new List<ushort>(held))try{Key(vk,true);}catch{}held.Clear();}if(mouseHeld){var input=new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{flags=4}}};SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)));mouseHeld=false;}}
 static IntPtr Window(int pid){IntPtr found=IntPtr.Zero;EnumWindows((hwnd,data)=>{uint actual;GetWindowThreadProcessId(hwnd,out actual);if(actual==pid&&IsWindowVisible(hwnd)){found=hwnd;return false;}return true;},IntPtr.Zero);if(found==IntPtr.Zero)throw new Exception("No visible window for approved target PID.");return found;}
 static object Observe(int pid){var hwnd=Window(pid);RECT rect;if(!GetWindowRect(hwnd,out rect))throw new Exception("Cannot inspect target bounds.");var title=new System.Text.StringBuilder(512);GetWindowText(hwnd,title,title.Capacity);return new {targetPid=pid,targetWindow=hwnd.ToInt64().ToString(),permissions=true,title=title.ToString(),bounds=new {x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top},note="Window metadata only; no screen pixels or private command lines."};}
 static void Check(){if(approvedWindow!=IntPtr.Zero&&GetForegroundWindow()!=approvedWindow)throw new Exception("Foreground target changed; input stopped.");if(interrupted)throw new Exception("Manual input/emergency stop interrupted control.");}
 static object Act(int pid,Dictionary<string,object> step,string expectedWindow){var hwnd=Window(pid);if(hwnd.ToInt64().ToString()!=expectedWindow)throw new Exception("Approved window changed; input refused.");string action=(string)step["action"];if((GetAsyncKeyState(17)&0x8000)!=0||(GetAsyncKeyState(18)&0x8000)!=0||(GetAsyncKeyState(16)&0x8000)!=0)throw new Exception("Release physical modifier keys before control.");interrupted=false;active=true;Status("TIM CONTROL ACTIVE / Ctrl+Alt+Esc stops");try{if(action=="wait"){int delay=Convert.ToInt32(step["ms"]);if(delay<0||delay>2000)throw new Exception("Invalid wait");for(int i=0;i<delay;i+=10){Check();Thread.Sleep(10);}return true;}if(GetForegroundWindow()!=hwnd&&(!SetForegroundWindow(hwnd)||GetForegroundWindow()!=hwnd))throw new Exception("Target could not become foreground; input refused.");approvedWindow=hwnd;Check();
 if(action=="focus")return true;
 if(action=="click"){RECT rect;GetWindowRect(hwnd,out rect);int x=Convert.ToInt32(step["x"]),y=Convert.ToInt32(step["y"]);if(x<0||y<0||x>=rect.Right-rect.Left||y>=rect.Bottom-rect.Top)throw new Exception("Click outside approved window");var move=new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{dx=(int)((long)(rect.Left+x-GetSystemMetrics(76))*65535/Math.Max(1,GetSystemMetrics(78)-1)),dy=(int)((long)(rect.Top+y-GetSystemMetrics(77))*65535/Math.Max(1,GetSystemMetrics(79)-1)),flags=1|0x8000|0x4000}}};if(SendInput(1,new[]{move},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("Cursor move rejected");Check();var down=new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{flags=2}}};var up=new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{flags=4}}};mouseHeld=true;if(SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("Click rejected");mouseHeld=false;return true;}
 if(action=="type"){string text=(string)step["text"];if(text.Length>2000)throw new Exception("Text too long");foreach(char c in text){Check();if(Char.IsControl(c))throw new Exception("Control character refused");Key(0,false,c,true);Key(0,true,c,true);}return true;}
 if(action=="key"){string[] keys=((string)step["key"]).Split('+');var special=new Dictionary<string,ushort>{{"CTRL",17},{"ALT",18},{"SHIFT",16},{"ENTER",13},{"ESC",27},{"TAB",9},{"BACKSPACE",8},{"DELETE",46},{"HOME",36},{"END",35},{"LEFT",37},{"UP",38},{"RIGHT",39},{"DOWN",40}};foreach(string name in keys){Check();ushort vk;if(!special.TryGetValue(name,out vk)){if(name.Length!=1||!Char.IsLetterOrDigit(name[0]))throw new Exception("Unsupported key");vk=name[0];}Key(vk,false);}Release();return true;}
 throw new Exception("Unsupported action");}finally{Release();approvedWindow=IntPtr.Zero;active=false;Status("TIM CONTROL / awaiting approval");}}
 static Dictionary<string,AutomationElement> semanticNodes=new Dictionary<string,AutomationElement>();
 static object ObserveSemantic(int pid){
  var hwnd=Window(pid);var root=AutomationElement.FromHandle(hwnd);var items=new List<object>();semanticNodes.Clear();var queue=new Queue<AutomationElement>();queue.Enqueue(root);var walker=TreeWalker.ControlViewWalker;
  while(queue.Count>0&&items.Count<200){var node=queue.Dequeue();try{var current=node.Current;if(current.ProcessId!=pid||current.IsPassword)continue;
   string id="uia:"+String.Join("-",Array.ConvertAll(node.GetRuntimeId(),x=>x.ToString()));string value="";var actions=new List<string>();object pattern;
   if(node.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)){var v=(ValuePattern)pattern;value=v.Current.Value??"";if(!v.Current.IsReadOnly)actions.Add("set_value");}
   if(node.TryGetCurrentPattern(InvokePattern.Pattern,out pattern))actions.Add("invoke");
   if(value.Length>2000)value=value.Substring(0,2000);string name=current.Name??"";if(name.Length>500)name=name.Substring(0,500);
   semanticNodes[id]=node;items.Add(new {id=id,name=name,role=current.ControlType.ProgrammaticName,value=value,enabled=current.IsEnabled,risk="unclassified",actions=actions.ToArray()});
   var child=walker.GetFirstChild(node);while(child!=null&&queue.Count+items.Count<200){queue.Enqueue(child);child=walker.GetNextSibling(child);}
  }catch(ElementNotAvailableException){}}
  return new {targetPid=pid,targetWindow=hwnd.ToInt64().ToString(),permissions=true,elements=items};
 }
 static object ActSemantic(int pid,Dictionary<string,object> p){
  var hwnd=Window(pid);if(hwnd.ToInt64().ToString()!=(string)p["targetWindow"])throw new Exception("Semantic target changed");
  AutomationElement node;if(!semanticNodes.TryGetValue((string)p["elementId"],out node)||node.Current.ProcessId!=pid||node.Current.IsPassword||!node.Current.IsEnabled)throw new Exception("Semantic element unavailable");
  if((GetAsyncKeyState(17)&0x8000)!=0||(GetAsyncKeyState(18)&0x8000)!=0||(GetAsyncKeyState(16)&0x8000)!=0)throw new Exception("Release physical modifiers before control");
  interrupted=false;active=true;Status("TIM CONTROL ACTIVE / semantic action / Ctrl+Alt+Esc");
  try{if(GetForegroundWindow()!=hwnd&&(!SetForegroundWindow(hwnd)||GetForegroundWindow()!=hwnd))throw new Exception("Foreground unavailable");approvedWindow=hwnd;Check();object pattern;string op=(string)p["operation"];
   if(op=="set_value"){string value=(string)p["value"];if(value.Length>2000||!node.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)||((ValuePattern)pattern).Current.IsReadOnly)throw new Exception("Writable ValuePattern unavailable");((ValuePattern)pattern).SetValue(value);}
   else if(op=="invoke"){if(!node.TryGetCurrentPattern(InvokePattern.Pattern,out pattern))throw new Exception("InvokePattern unavailable");((InvokePattern)pattern).Invoke();}
   else throw new Exception("Unsupported semantic action");Check();return new {ok=true};
  }finally{Release();approvedWindow=IntPtr.Zero;active=false;Status("TIM CONTROL / awaiting approval");}
 }
 static int Main(string[] args){var capabilities=new {semanticVersion=1,foregroundInput=true,emergencyStop=true,manualInputInterruption=true,platform="win32",emergencyChord="Ctrl+Alt+Esc",verification="foreground target/window presence only; application task semantics require user verification",screenshots=false};if(Array.IndexOf(args,"--capabilities")>=0){Emit(capabilities);return 0;}
 SetProcessDPIAware();var ready=new ManualResetEvent(false);new Thread(()=>{keyboardHook=SetWindowsHookEx(13,keyboardProc,GetModuleHandle(null),0);mouseHook=SetWindowsHookEx(14,mouseProc,GetModuleHandle(null),0);indicator=new Indicator();ready.Set();System.Windows.Forms.Application.Run(indicator);}){IsBackground=true}.Start();ready.WaitOne();try{string line;while((line=Console.ReadLine())!=null){object id=null;try{if(line.Length>16384)throw new Exception("Request too large");var req=json.Deserialize<Dictionary<string,object>>(line);id=req["id"];string method=(string)req["method"];var p=(Dictionary<string,object>)req["params"];object result;if(method=="capabilities"){if(keyboardHook==IntPtr.Zero||mouseHook==IntPtr.Zero)throw new Exception("Native interruption hooks unavailable; control disabled");result=capabilities;}else if(method=="releaseAll"){Release();active=false;result=true;}else{int pid=Convert.ToInt32(p["targetPid"]);if(method=="observeSemantic")result=ObserveSemantic(pid);else if(method=="actSemantic")result=ActSemantic(pid,p);else if(method=="observe")result=Observe(pid);else if(method=="act")result=Act(pid,(Dictionary<string,object>)p["step"],(string)p["targetWindow"]);else if(method=="verify")result=Window(pid)!=IntPtr.Zero&&!interrupted&&(((Dictionary<string,object>)p["step"])["action"].ToString()=="observe"||((Dictionary<string,object>)p["step"])["action"].ToString()=="wait"||GetForegroundWindow()==Window(pid));else throw new Exception("Unsupported method");}Emit(new {id=id,result=result});}catch(Exception e){Release();active=false;Emit(new {id=id,error=e.Message});}}}finally{Release();if(keyboardHook!=IntPtr.Zero)UnhookWindowsHookEx(keyboardHook);if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);}return 0;
 }
}
