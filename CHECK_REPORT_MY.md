# စစ်ဆေးမှုအစီရင်ခံစာ

## ဒီ environment မှာ စစ်ထားတာ
- `app.py` ကို `python -m py_compile` နဲ့ syntax စစ်ပြီး အောင်မြင်သည်။
- Local FFmpeg ဖြင့် 4-second synthetic video + 3-second voice ကို 360p ထုတ်သည့် end-to-end render smoke test အောင်မြင်သည်။ Output MP4 duration 3.0 seconds ဖြစ်သည်။
- Multi-scene input split, scene concat, blur band, caption overlay, H.264/AAC encode path ကို smoke test လုပ်ထားသည်။
- Original `Si-Gyi-Recap-Studio-speed-sync-style-v2.zip` ကို `browser_v2_reference/` အောက်မှာ မူရင်း backup အဖြစ် ထည့်ထားသည်။ Streamlit app က ဒီ folder ကို run မလုပ်ပါ။

## ဒီ environment မှာ မစမ်းနိုင်ခဲ့တာ
- Internet access မရှိလို့ `requirements.txt` packages ကို install လုပ်ပြီး Streamlit app ကို အပြည့်အဝ run မလုပ်နိုင်ခဲ့ပါ။
- Gemini API key နဲ့ live Gemini request မစမ်းနိုင်ခဲ့ပါ။
- Microsoft Edge TTS service ကို live ခေါ်ပြီး Thiha/Nilar voice test မလုပ်နိုင်ခဲ့ပါ။
- Streamlit Community Cloud မှာ deploy/1-minute real video test မလုပ်နိုင်ခဲ့ပါ။

ထို့ကြောင့် production အတွက် “error လုံးဝမဖြစ်ဘူး” လို့ အာမမခံနိုင်ပါ။ Cloud မှာ ပထမဆုံး 360p ဖြင့် 10–20 second clip ကိုစမ်းပြီး အောင်မြင်မှ 1 minute 720p ကို စမ်းပါ။
