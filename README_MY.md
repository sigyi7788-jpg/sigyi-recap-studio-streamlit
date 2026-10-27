# Si-Gyi Recap Studio — GitHub + Streamlit

ဒီ Version က V2 browser app ကို Streamlit ပေါ်မှာ တိုက်ရိုက် run မလုပ်ဘဲ Python UI + server-side FFmpeg pipeline အဖြစ် ပြောင်းထားတဲ့ **စမ်းသပ် Version** ဖြစ်ပါတယ်။

## ပါဝင်တာ
- Gemini 3.8 Flash မှာ audio transcript + Burmese script
- Script ကို render မလုပ်ခင် ပြင်နိုင်ခြင်း
- Edge TTS `my-MM-NilarNeural` / `my-MM-ThihaNeural`
- TTS clip တစ်ခုချင်းထုတ်ပြီး duration အလိုက် timeline တည်ဆောက်ခြင်း
- Server-side FFmpeg H.264/AAC render, scene timing, blur band, Burmese caption overlay, frame Fit/Fill, zoom, style preset, optional logo
- Output preview + MP4 download

## GitHub + Streamlit Community Cloud တင်နည်း
1. ZIP ကို ဖြည်ပါ။ အတွင်းက `app.py`, `requirements.txt`, `packages.txt`, `.streamlit/` ဖိုင်တွေကို GitHub repository root ထဲတင်ပါ။
2. Streamlit Community Cloud မှာ repository ကိုရွေးပြီး Main file path ကို `app.py` ထားပါ။
3. App Settings → Secrets ထဲမှာ `GEMINI_API_KEY = "your_api_key"` ထည့်နိုင်ပါတယ်။ မထည့်ရင် app sidebar ထဲမှာ key ကို session အတွင်း ရိုက်ထည့်ပါ။
4. Deploy လုပ်ပါ။

## အရေးကြီးသော ကန့်သတ်ချက်
- Streamlit Community Cloud မှာ CPU/RAM ကန့်သတ်ချက်ရှိတယ်။ 1 မိနစ် 720p က စမ်းသပ်နိုင်တဲ့ target ဖြစ်ပေမယ့် အောင်မြင်မှု/အချိန်ကို အာမမခံနိုင်ပါ။ RAM မလုံလောက်ရင် 360p သုံးပါ။
- 1080p သို့မဟုတ် ဖိုင်ကြီးများမှာ Out of Memory / timeout ဖြစ်နိုင်တယ်။
- Gemini API key/quota/server busy ပြဿနာတွေကို hosting ပြောင်းရုံနဲ့ မဖြေရှင်းနိုင်ပါ။
- Edge TTS က Microsoft online service ကို ခေါ်တာဖြစ်လို့ Internet ရှိဖို့လိုပြီး service က rate limit လုပ်နိုင်ပါတယ်။
- Burmese font rendering က Streamlit Cloud ရဲ့ font package install အပေါ်မူတည်တယ်။ `packages.txt` ထဲမှာ Noto fonts ထည့်ထားပါတယ်။
- Original V2 နဲ့ UI/feature parity အပြည့်မဟုတ်သေးပါ။ ဒီဟာက server-render workflow ကို စမ်းသပ်ဖို့ minimal rebuild ဖြစ်ပါတယ်။
