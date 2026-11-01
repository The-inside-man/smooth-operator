using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Web.Script.Serialization;
class TimVoiceCapture {
 static JavaScriptSerializer json = new JavaScriptSerializer();
 static void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
 static int Main(string[] args) {
  try {
   if(Array.IndexOf(args,"--devices")>=0) { Emit(new {type="devices",devices=new[]{new {id="default",name="Windows default recording device"}},note="Choose another device in Windows sound settings. No microphone was opened."}); return 0; }
   string device=Environment.GetEnvironmentVariable("TIM_VOICE_DEVICE")??"default";
   if(device!="default")throw new Exception("This adapter supports only the Windows default input device.");
   string language=Environment.GetEnvironmentVariable("TIM_VOICE_LANGUAGE");
   using(var engine=String.IsNullOrEmpty(language)?new SpeechRecognitionEngine():new SpeechRecognitionEngine(new CultureInfo(language))) {
    engine.LoadGrammar(new DictationGrammar());
    engine.SetInputToDefaultAudioDevice();
    Emit(new {type="ready",device="default",transcription="local Windows System.Speech"});
    while(true) { var result=engine.Recognize(TimeSpan.FromSeconds(5)); if(result!=null)Emit(new {type="transcript",id=Guid.NewGuid().ToString(),final=true,text=result.Text,confidence=result.Confidence}); }
   }
  } catch(Exception error) { Emit(new {type="error",message=error.Message});return 1; }
 }
}
