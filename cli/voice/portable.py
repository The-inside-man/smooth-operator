"""Opt-in local CPU transcription. No downloads, network, persistence or focus APIs."""
import os,sys,json,queue,uuid
def emit(data): print(json.dumps(data),flush=True)
def main():
    import sounddevice as sd
    if "--devices" in sys.argv:
        emit({"devices":[{"id":i,"name":d["name"],"channels":d["max_input_channels"]} for i,d in enumerate(sd.query_devices()) if d["max_input_channels"]>0]})
        return
    model_path=os.environ.get("TIM_SPEECH_MODEL","")
    if not os.path.isabs(model_path) or not os.path.isdir(model_path):
        raise RuntimeError("Choose an existing absolute TIM_SPEECH_MODEL directory. No model is automatically downloaded.")
    from vosk import Model,KaldiRecognizer,SetLogLevel
    SetLogLevel(-1)
    chosen=os.environ.get("TIM_VOICE_DEVICE","default")
    device=None if chosen=="default" else int(chosen) if chosen.isdigit() else chosen
    frames=queue.Queue(maxsize=32)
    failed=[]
    def callback(data,count,timing,status):
        if status: failed.append(str(status))
        try: frames.put_nowait(bytes(data))
        except queue.Full: failed.append("Audio queue overflow; transcription stopped rather than dropping control words")
    rate=16000
    recognizer=KaldiRecognizer(Model(model_path),rate)
    recognizer.SetWords(True)
    with sd.RawInputStream(samplerate=rate,blocksize=4000,device=device,dtype="int16",channels=1,callback=callback):
        emit({"type":"ready","device":chosen,"transcription":"local CPU / vosk","audioUpload":False})
        while True:
            if failed: raise RuntimeError(failed[0])
            try: data=frames.get(timeout=2)
            except queue.Empty: continue
            if recognizer.AcceptWaveform(data):
                result=json.loads(recognizer.Result())
                words=result.get("result",[])
                confidence=sum(float(w.get("conf",0)) for w in words)/len(words) if words else 0
                text=result.get("text","")
                if text: emit({"type":"transcript","id":str(uuid.uuid4()),"text":text[:8192],"final":True,"confidence":confidence})
if __name__=="__main__":
    try: main()
    except KeyboardInterrupt: pass
    except Exception as exc:
        emit({"type":"error","message":str(exc)[:1000]})
        sys.exit(1)
