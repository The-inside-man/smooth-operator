using System;
using System.Windows.Forms;
class DesktopFixture {
 [STAThread] static void Main(){
  var form=new Form{Text="TIM desktop validation fixture - no files or network",Width=640,Height=240};
  var input=new TextBox{Name="TIMFixtureDraft",AccessibleName="Fixture draft",Top=35,Left=20,Width=560};
  var label=new Label{Name="TIMFixtureStatus",AccessibleName="Fixture status",Text="Not saved",Top=115,Left=20,Width=560};
  var button=new Button{Name="TIMFixtureSave",AccessibleName="Save fixture draft",Text="Save fixture draft",Top=75,Left=20,Width=180};
  button.Click+=(s,e)=>{label.Text="Saved: "+input.Text;label.AccessibleName=label.Text;};
  form.Controls.Add(input);form.Controls.Add(button);form.Controls.Add(label);
  Console.WriteLine("Fixture PID: "+System.Diagnostics.Process.GetCurrentProcess().Id);
  Application.Run(form);
 }
}
