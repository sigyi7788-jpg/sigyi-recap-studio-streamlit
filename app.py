from __future__ import annotations
import asyncio, json, os, re, shutil, subprocess, tempfile, threading, time
from pathlib import Path
from typing import Any

import streamlit as st
from PIL import Image, ImageDraw, ImageFont

APP_TITLE = 'Si-Gyi Recap Studio — Streamlit'
MODEL_DEFAULT = 'gemini-3.8-flash'
VOICES = {
    'Nilar Neural (မိန်းကလေး)': 'my-MM-NilarNeural',
    'Thiha Neural (ယောက်ျားလေး)': 'my-MM-ThihaNeural',
}
RESOLUTIONS = {'360p (ပိုမြန်)': (360, 640, 18), '720p (အကြံပြု)': (720, 1280, 20), '1080p (စက်အားကောင်းမှ)': (1080, 1920, 24)}

st.set_page_config(page_title=APP_TITLE, page_icon='🎬', layout='wide')
st.title('🎬 Si-Gyi Recap Studio')
st.caption('GitHub + Streamlit | Gemini Script → Thiha/Nilar TTS → Server-side FFmpeg Render')


def run_cmd(args: list[str], timeout: int = 300, input_data: bytes | None = None) -> subprocess.CompletedProcess:
    try:
        p = subprocess.run(args, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    except FileNotFoundError as e:
        raise RuntimeError('FFmpeg မတွေ့ပါ။ packages.txt ထဲမှာ ffmpeg ပါမပါ စစ်ပါ။') from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f'လုပ်ဆောင်ချိန် {timeout} စက္ကန့် ကျော်သွားပါတယ်။ 360p သို့မဟုတ် ပိုတိုတဲ့ Video နဲ့ ပြန်စမ်းပါ။') from e
    if p.returncode != 0:
        msg = p.stderr.decode('utf-8', 'replace')[-3000:]
        raise RuntimeError(msg or f'Command failed: {args[0]}')
    return p


def probe_duration(path: str) -> float:
    p = run_cmd(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], timeout=30)
    try: return float(p.stdout.decode().strip())
    except Exception as e: raise RuntimeError('Video/Audio duration ကို မဖတ်နိုင်ပါ။') from e


def safe_json(raw: str) -> dict[str, Any]:
    text = (raw or '').strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.I)
    text = re.sub(r'\s*```$', '', text)
    a, b = text.find('{'), text.rfind('}')
    if a >= 0 and b > a: text = text[a:b+1]
    try: data = json.loads(text)
    except json.JSONDecodeError as e: raise RuntimeError(f'Gemini JSON ဖတ်မရပါ။ ပြန်စမ်းပါ။ ({e})') from e
    if not isinstance(data, dict) or not isinstance(data.get('segments'), list):
        raise RuntimeError('Gemini အဖြေမှာ segments မပါပါ။')
    out = []
    for item in data['segments']:
        if not isinstance(item, dict): continue
        try: start = max(0.0, float(item.get('start', 0)))
        except Exception: start = 0.0
        try: end = max(start + 0.2, float(item.get('end', start + 2.5)))
        except Exception: end = start + 2.5
        original = str(item.get('original', '') or '').strip()
        burmese = str(item.get('burmese', '') or '').strip()
        if original or burmese:
            out.append({'start': start, 'end': end, 'original': original, 'burmese': burmese})
    if not out: raise RuntimeError('Gemini က Script segment မထုတ်ပေးပါ။')
    out.sort(key=lambda x: x['start'])
    return {'language': str(data.get('language', 'unknown')), 'segments': out}


def analyze_audio(video_path: str, api_key: str, status_box) -> dict[str, Any]:
    status_box.info('① Video ထဲက အသံကို 16 kHz mono WAV အဖြစ် ထုတ်နေပါတယ်…')
    audio_path = str(Path(video_path).with_name('source_audio.wav'))
    run_cmd(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', video_path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio_path], timeout=180)
    if os.path.getsize(audio_path) < 1000: raise RuntimeError('Video ထဲမှာ အသုံးပြုနိုင်တဲ့ အသံ မတွေ့ပါ။')
    status_box.info('② Gemini 3.8 Flash ကို Transcript + မြန်မာ Script တောင်းနေပါတယ်…')
    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        raise RuntimeError('google-genai package မတပ်ဆင်ရသေးပါ။ requirements.txt ကို စစ်ပါ။') from e
    client = genai.Client(api_key=api_key)
    audio_bytes = Path(audio_path).read_bytes()
    prompt = '''You are a professional transcription and Burmese recap assistant. Listen to the entire audio and return ONLY valid JSON in this exact schema:
{"language":"spoken language","segments":[{"start":0.0,"end":3.2,"original":"exact words spoken","burmese":"natural Burmese narration"}]}
Rules:
- Transcribe all speech accurately, in order; do not invent or omit spoken words.
- start/end are seconds from the beginning of the audio, decimal numbers, no timestamps as strings.
- Use short segments, generally 2–5 seconds, no overlap, in order.
- original is the source speech. burmese is natural spoken Myanmar Unicode Burmese translation, concise enough for at most two subtitle lines.
- If source speech is already Burmese, polish lightly but preserve meaning.
- Return JSON only, no Markdown fences or explanations.'''
    try:
        response = client.models.generate_content(
            model=MODEL_DEFAULT,
            contents=[types.Part.from_bytes(data=audio_bytes, mime_type='audio/wav'), prompt],
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type='application/json',
                thinking_config=types.ThinkingConfig(thinking_level='low'),
            ),
        )
        return safe_json(response.text or '')
    except Exception as e:
        msg = str(e)
        if any(x in msg.lower() for x in ['429', 'resource_exhausted', 'quota']):
            raise RuntimeError('Gemini API quota/rate limit ပြည့်နေပါတယ်။ Google AI Studio မှာ quota နဲ့ billing ကို စစ်ပါ။') from e
        if any(x in msg.lower() for x in ['503', 'unavailable', 'overloaded', 'server busy']):
            raise RuntimeError('Gemini Server Busy ဖြစ်နေပါတယ်။ Hosting ပြောင်းတာနဲ့ ဒီ API အမှားက အလိုအလျောက် မပျောက်ပါ။ ခဏနောက် ပြန်စမ်းပါ။') from e
        if any(x in msg.lower() for x in ['api key', '401', '403', 'permission']):
            raise RuntimeError('Gemini API Key မှားနေခြင်း သို့မဟုတ် ခွင့်ပြုချက်မရှိခြင်း ဖြစ်နိုင်ပါတယ်။ Key ကို ပြန်စစ်ပါ။') from e
        raise RuntimeError(f'Gemini Script ထုတ်မရပါ: {msg[:900]}') from e


async def synthesize_all(texts: list[str], voice: str, rate: float, workdir: str, progress, status_box) -> tuple[str, list[dict[str, Any]], float]:
    try: import edge_tts
    except Exception as e: raise RuntimeError('edge-tts package မတပ်ဆင်ရသေးပါ။') from e
    valid = [(i, t.strip()) for i, t in enumerate(texts) if t.strip()]
    if not valid: raise RuntimeError('TTS အတွက် မြန်မာ Script မရှိပါ။')
    rate_pct = int(round((rate - 1.0) * 100))
    rate_text = f'{rate_pct:+d}%'
    semaphore = asyncio.Semaphore(3)
    files: dict[int, str] = {}
    errors: list[str] = []
    done = 0
    async def one(i: int, text: str):
        nonlocal done
        async with semaphore:
            mp3 = os.path.join(workdir, f'tts_{i:04d}.mp3')
            wav = os.path.join(workdir, f'tts_{i:04d}.wav')
            try:
                await edge_tts.Communicate(text, voice=voice, rate=rate_text).save(mp3)
                filters = ['highpass=f=70', 'loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=24000', 'asetpts=PTS-STARTPTS']
                if i == valid[0][0]: filters.append('adelay=140|140')
                run_cmd(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',mp3,'-af',','.join(filters),'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',wav], timeout=90)
                if os.path.getsize(wav) < 1000: raise RuntimeError('အသံဖိုင် အလွတ်နီးပါး ဖြစ်နေပါတယ်။')
                files[i] = wav
            except Exception as e: errors.append(f'Segment {i+1}: {e}')
            finally:
                done += 1
                progress.progress(done / len(valid), text=f'TTS အသံထုတ်နေပါတယ်… {done}/{len(valid)}')
    await asyncio.gather(*(one(i,t) for i,t in valid))
    if errors: raise RuntimeError('TTS အချို့ မအောင်မြင်ပါ။\n' + '\n'.join(errors[:3]))
    ordered = [files[i] for i, _ in valid]
    concat_list = os.path.join(workdir, 'audio_concat.txt')
    with open(concat_list, 'w', encoding='utf-8') as f:
        for path in ordered: f.write("file '" + path.replace("'", "'\\''") + "'\n")
    voice_path = os.path.join(workdir, 'voice.wav')
    run_cmd(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',concat_list,'-c:a','pcm_s16le','-ar','24000','-ac','1',voice_path], timeout=180)
    timeline = [{'start':0.0,'end':0.0,'skip':True} for _ in texts]
    cursor = 0.0
    for i, _ in valid:
        d = probe_duration(files[i])
        timeline[i] = {'start': round(cursor, 3), 'end': round(cursor+d, 3), 'skip': False}
        cursor += d
    total = probe_duration(voice_path)
    status_box.success(f'TTS ပြီးပါပြီ — အသံကြာချိန် {total:.1f} စက္ကန့်')
    return voice_path, timeline, total


def font_path() -> str:
    candidates = [
        '/usr/share/fonts/truetype/noto/NotoSansMyanmar-Regular.ttf',
        '/usr/share/fonts/opentype/noto/NotoSansMyanmar-Regular.ttf',
        '/usr/share/fonts/truetype/NotoSansMyanmar-Regular.ttf',
    ]
    for p in candidates:
        if os.path.exists(p): return p
    try:
        p = subprocess.run(['fc-match','-f','%{file}','Noto Sans Myanmar'], capture_output=True, text=True, timeout=10).stdout.strip()
        if p and os.path.exists(p): return p
    except Exception: pass
    raise RuntimeError('မြန်မာ Font မတွေ့ပါ။ packages.txt ထဲမှာ fonts-noto-core ပါမပါ စစ်ပါ။')


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    text = re.sub(r'\s+', ' ', text.strip())
    if not text: return []
    # Prefer word boundaries, then split very long Burmese runs by characters.
    units = text.split(' ')
    lines: list[str] = []
    current = ''
    for unit in units:
        trial = unit if not current else current + ' ' + unit
        if draw.textbbox((0,0), trial, font=font, stroke_width=0)[2] <= max_width:
            current = trial; continue
        if current: lines.append(current); current = ''
        if draw.textbbox((0,0), unit, font=font)[2] <= max_width:
            current = unit
        else:
            chunk = ''
            for char in unit:
                if draw.textbbox((0,0), chunk+char, font=font)[2] <= max_width: chunk += char
                else:
                    if chunk: lines.append(chunk)
                    chunk = char
            current = chunk
    if current: lines.append(current)
    if len(lines) > 2:
        lines = [lines[0], ''.join(lines[1:])]
        while draw.textbbox((0,0), lines[1], font=font)[2] > max_width and len(lines[1]) > 2:
            lines[1] = lines[1][:-1]
        lines[1] += '…'
    return lines[:2]


def make_caption_png(text: str, path: str, width: int, fontfile: str, resolution_scale: float, color: str = '#ffdf3d', font_base: int = 28) -> int:
    font_size = max(16, int(font_base * resolution_scale))
    try: font = ImageFont.truetype(fontfile, font_size, layout_engine=ImageFont.Layout.RAQM)
    except Exception: font = ImageFont.truetype(fontfile, font_size)
    height = int(font_size * 3.4 + 40 * resolution_scale)
    image = Image.new('RGBA', (width, height), (0,0,0,0))
    draw = ImageDraw.Draw(image)
    lines = wrap_text(draw, text, font, int(width * 0.90))
    if not lines: image.save(path); return height
    line_boxes = [draw.textbbox((0,0), line, font=font, stroke_width=max(1,int(2*resolution_scale))) for line in lines]
    line_heights = [max(1, b[3]-b[1]) for b in line_boxes]
    gap = max(3, int(4*resolution_scale))
    pad_x, pad_y = int(20*resolution_scale), int(10*resolution_scale)
    content_w = max(b[2]-b[0] for b in line_boxes)
    content_h = sum(line_heights) + gap*(len(lines)-1)
    box_w = min(width-int(width*.04), content_w + 2*pad_x)
    box_h = content_h + 2*pad_y
    x0, y0 = (width-box_w)//2, (height-box_h)//2
    draw.rounded_rectangle((x0,y0,x0+box_w,y0+box_h), radius=max(4,int(10*resolution_scale)), fill=(10,10,10,210), outline=(0,0,0,255), width=max(1,int(2*resolution_scale)))
    y = y0 + pad_y
    for line, box, lh in zip(lines, line_boxes, line_heights):
        tw = box[2]-box[0]
        x = (width-tw)//2
        draw.text((x,y-box[1]), line, font=font, fill=color, stroke_width=max(1,int(2*resolution_scale)), stroke_fill=(0,0,0,255))
        y += lh + gap
    image.save(path)
    return height


def render_server(video_path: str, voice_path: str, segments: list[dict], timeline: list[dict], workdir: str,
                  resolution_label: str, fit_mode: str, zoom: float, blur_top: float, blur_height: float,
                  caption_y: float, preset: str, logo_path: str | None, logo_position: str, progress, status_box,
                  brightness: float = 0, contrast_adjust: float = 0, saturation_adjust: float = 0,
                  blur_strength: float = 18, flip: bool = False, caption_color: str = '#ffdf3d', caption_font_size: int = 28) -> str:
    W,H,fps = RESOLUTIONS[resolution_label]
    source_duration = probe_duration(video_path)
    target_duration = probe_duration(voice_path)
    active = []
    for i, seg in enumerate(segments):
        t = timeline[i] if i < len(timeline) else {'skip':True}
        if t.get('skip') or not str(seg.get('burmese','')).strip(): continue
        start = max(0.0, min(source_duration, float(seg.get('start',0))))
        end = max(start, min(source_duration, float(seg.get('end',0))))
        out_start, out_end = float(t['start']), float(t['end'])
        if end-start < .12 or out_end-out_start < .08: continue
        active.append((start,end,out_start,out_end,i))
    if not active:
        # Fallback to one full-length visual segment if timestamp data was not usable.
        active = [(0.0, source_duration, 0.0, target_duration, -1)]
    filter_parts=[]
    scene_labels=[]
    # An input video stream must be split before it is used by multiple trim filters.
    if len(active) > 1:
        filter_parts.append('[0:v]split=' + str(len(active)) + ''.join(f'[src{n}]' for n in range(len(active))))
    preset_vals = {'Natural':(1.0,1.0,1.0),'Cinematic':(1.035,.96,1.0),'Vivid':(1.05,1.16,1.0),'Mono':(1.04,0.0,1.0)}
    contrast,saturation,brightness = preset_vals.get(preset,(1.035,.96,1.0))
    for n,(start,end,out_start,out_end,idx) in enumerate(active):
        span = max(.1,end-start); outspan = max(.1,out_end-out_start)
        ratio = outspan/span
        if fit_mode == 'Fit (အပြည့်မြင်) ': fit_mode = 'Fit (အပြည့်မြင်)'
        if fit_mode.startswith('Fit'):
            visual = f'scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black'
        else:
            visual = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}'
        if zoom > 1.001:
            zw,zh=int(W*zoom),int(H*zoom)
            visual += f',scale={zw}:{zh},crop={W}:{H}:(iw-ow)/2:(ih-oh)/2'
        if flip: visual += ',hflip'
        eqsat = 0 if preset == 'Mono' else max(0.0, saturation * (1 + saturation_adjust/100))
        eqcontrast = max(0.1, contrast * (1 + contrast_adjust/100))
        eqbrightness = max(-1.0, min(1.0, brightness/100.0))
        chain = f'trim=start={start:.4f}:end={end:.4f},setpts=PTS-STARTPTS,setpts=PTS*{ratio:.7f},{visual},fps={fps},setsar=1,eq=contrast={eqcontrast:.3f}:saturation={eqsat:.3f}:brightness={eqbrightness:.3f}'
        filter_parts.append(f'[{"src"+str(n) if len(active)>1 else "0:v"}]{chain}[sc{n}]')
        scene_labels.append(f'[sc{n}]')
    if len(scene_labels)==1: filter_parts.append(f'{scene_labels[0]}null[vcat]')
    else: filter_parts.append(''.join(scene_labels)+f'concat=n={len(scene_labels)}:v=1:a=0[vcat]')
    blur_y = max(0,min(H-2,int(H*blur_top/100)))
    blur_h = max(2,min(H-blur_y,int(H*blur_height/100)))
    filter_parts.append(f'[vcat]split=2[vbase][vbsrc]')
    filter_parts.append(f'[vbsrc]crop={W}:{blur_h}:0:{blur_y},gblur=sigma={max(1.0, float(blur_strength)):.1f}[blurband]')
    filter_parts.append(f'[vbase][blurband]overlay=0:{blur_y}:shortest=1[vblur]')
    current='vblur'
    args=['ffmpeg','-y','-hide_banner','-loglevel','error','-i',video_path,'-i',voice_path]
    next_input=2
    if logo_path:
        args += ['-loop','1','-framerate',str(fps),'-i',logo_path]
        logo_idx=next_input; next_input += 1
        lw=max(40,int(W*.18)); margin=max(8,int(W*.035))
        positions={'Top right':(f'W-w-{margin}',str(margin)),'Top left':(str(margin),str(margin)),'Bottom right':(f'W-w-{margin}',f'H-h-{margin}'),'Bottom left':(str(margin),f'H-h-{margin}')}
        x,y=positions.get(logo_position,positions['Top right'])
        filter_parts.append(f'[{logo_idx}:v]scale={lw}:-1,format=rgba[logo]')
        filter_parts.append(f'[{current}][logo]overlay=x={x}:y={y}:shortest=1[vlogo]')
        current='vlogo'
    fontfile=font_path()
    caption_paths=[]
    for i,seg in enumerate(segments):
        if i>=len(timeline) or timeline[i].get('skip'): continue
        txt=str(seg.get('burmese','')).strip()
        if not txt: continue
        png=os.path.join(workdir,f'caption_{i:04d}.png')
        ph=make_caption_png(txt,png,W,fontfile,W/360.0,caption_color,caption_font_size)
        args += ['-loop','1','-framerate',str(fps),'-t',f'{target_duration:.3f}','-i',png]
        idx=next_input; next_input+=1
        y=max(0,min(H-ph,int(H*caption_y/100-ph/2)))
        start=float(timeline[i]['start']); end=float(timeline[i]['end'])
        label=f'vcap{len(caption_paths)}'
        filter_parts.append(f'[{current}][{idx}:v]overlay=0:{y}:eof_action=pass:shortest=0:enable=\'between(t,{start:.3f},{end:.3f})\'[{label}]')
        current=label; caption_paths.append(png)
    filter_complex=';'.join(filter_parts)
    output=os.path.join(workdir,'Si-Gyi-Recap-Output.mp4')
    args += ['-filter_complex',filter_complex,'-map',f'[{current}]','-map','1:a:0','-t',f'{target_duration:.3f}',
             '-r',str(fps),'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p',
             '-c:a','aac','-b:a','128k','-movflags','+faststart','-progress','pipe:1','-nostats',output]
    status_box.info('③ FFmpeg Server Render စတင်ပါပြီ… ဒီအဆင့်မှာ Server က Video ကို တကယ် encode လုပ်နေပါတယ်။')
    proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    stderr_lines=[]
    def read_err():
        try:
            for line in proc.stderr:
                stderr_lines.append(line.rstrip())
                if len(stderr_lines)>80: del stderr_lines[:20]
        except Exception: pass
    thread=threading.Thread(target=read_err,daemon=True); thread.start()
    last_update=0
    try:
        for line in proc.stdout:
            line=line.strip()
            if line.startswith('out_time_ms='):
                try:
                    ms=int(line.split('=',1)[1]); ratio=min(.99,ms/(target_duration*1_000_000))
                    progress.progress(max(0.01,ratio),text=f'Video Render… {int(ratio*100)}%')
                except Exception: pass
            elif line=='progress=end': progress.progress(1.0,text='Render ပြီးပါပြီ')
        code=proc.wait(timeout=max(240,int(target_duration*10)))
    except subprocess.TimeoutExpired:
        proc.kill(); raise RuntimeError('Server Render အချိန်ကုန်သွားပါတယ်။ 360p နဲ့ ပြန်စမ်းပါ။')
    thread.join(timeout=2)
    if code != 0 or not os.path.exists(output) or os.path.getsize(output)<10000:
        raise RuntimeError('FFmpeg Render မအောင်မြင်ပါ:\n'+'\n'.join(stderr_lines[-15:]))
    status_box.success(f'Render အောင်မြင်ပါပြီ — {os.path.getsize(output)/1024/1024:.1f} MB')
    return output


with st.sidebar:
    st.header('⚙️ API / Render Settings')
    secret_key = ''
    try: secret_key = st.secrets.get('GEMINI_API_KEY', '')
    except Exception: pass
    api_key = st.text_input('Gemini API Key', value=secret_key, type='password', help='Key ကို GitHub code ထဲ မထည့်ပါနဲ့။ Streamlit Secrets သုံးနိုင်ပါတယ်။')
    voice_label = st.selectbox('အသံ', list(VOICES.keys()), index=0)
    rate = st.slider('အသံမြန်နှုန်း', 0.8, 1.5, 1.25, 0.05)
    resolution_label = st.selectbox('Output Resolution', list(RESOLUTIONS.keys()), index=1)
    fit_mode = st.selectbox('Frame', ['Fill (မျက်နှာပြင်ပြည့်)', 'Fit (အပြည့်မြင်)'])
    zoom = st.slider('Zoom', 1.0, 1.12, 1.0, 0.01)
    flip = st.checkbox('Horizontal Flip', value=False)
    preset = st.selectbox('Visual Style', ['Natural','Cinematic','Vivid','Mono'], index=1)
    brightness = st.slider('Brightness', -30, 30, 0)
    contrast_adjust = st.slider('Contrast', -30, 30, 0)
    saturation_adjust = st.slider('Saturation', -50, 50, 0)
    blur_strength = st.slider('Blur Strength', 3, 40, 18)
    caption_font_size = st.slider('မြန်မာစာတန်း Font Size', 18, 40, 28)
    caption_color_label = st.selectbox('စာတန်းအရောင်', ['အဝါ', 'အဖြူ'])
    caption_color = '#ffdf3d' if caption_color_label == 'အဝါ' else '#ffffff'
    blur_top = st.slider('Original စာတန်း Blur စတင်ရာ (%)', 0, 90, 58)
    blur_height = st.slider('Blur အမြင့် (%)', 3, 30, 13)
    caption_y = st.slider('မြန်မာစာတန်း အလယ်နေရာ (%)', 10, 95, 73)
    logo_position = st.selectbox('Logo နေရာ', ['Top right','Top left','Bottom right','Bottom left'])
    st.caption('Streamlit Community Cloud မှာ Memory ကန့်သတ်ချက်ရှိပါတယ်။ 720p ကို စမ်းပြီး မအောင်မြင်ရင် 360p ရွေးပါ။')

uploaded_video = st.file_uploader('🎞️ Video တင်ပါ (MP4 / MOV / MKV)', type=['mp4','mov','mkv','webm'])
uploaded_logo = st.file_uploader('Logo (မထည့်လည်းရပါတယ်)', type=['png','jpg','jpeg','webp'])
if uploaded_video:
    st.video(uploaded_video)
    st.caption(f'Video: {uploaded_video.name} · {uploaded_video.size/1024/1024:.1f} MB')

if 'segments' not in st.session_state: st.session_state.segments = None
if 'output_bytes' not in st.session_state: st.session_state.output_bytes = None
if 'output_name' not in st.session_state: st.session_state.output_name = 'Si-Gyi-Recap-Output.mp4'

col1,col2=st.columns(2)
with col1:
    analyze_clicked=st.button('① Gemini Script ထုတ်မယ်', type='primary', use_container_width=True, disabled=not uploaded_video or not api_key)
with col2:
    render_clicked=st.button('② TTS + Server Render', use_container_width=True, disabled=not uploaded_video or not st.session_state.segments)

if analyze_clicked:
    with st.spinner('Gemini Script ထုတ်နေပါတယ်… Video တစ်မိနစ်ဆိုလည်း API/Network အခြေအနေပေါ်မူတည်နိုင်ပါတယ်။'):
        try:
            with tempfile.TemporaryDirectory(prefix='sigyi_analyze_') as td:
                video_path=os.path.join(td, uploaded_video.name or 'input.mp4')
                Path(video_path).write_bytes(uploaded_video.getvalue())
                status=st.empty()
                result=analyze_audio(video_path, api_key, status)
                st.session_state.segments=result['segments']
                st.session_state.output_bytes=None
                st.success(f"Script ထွက်ပါပြီ — {len(result['segments'])} segments · language: {result['language']}")
        except Exception as e: st.error(str(e))

if st.session_state.segments:
    st.subheader('📝 Script စစ်ဆေး / ပြင်ဆင်ပါ')
    st.caption('Gemini ထုတ်ထားတဲ့ မြန်မာစာကို လိုအပ်ရင် အောက်မှာပြင်နိုင်ပါတယ်။ အချိန်တွေကို မပြောင်းထားပါ။')
    for i, seg in enumerate(st.session_state.segments):
        label=f"{i+1}. {seg['start']:.1f}s–{seg['end']:.1f}s | Original: {seg['original'][:100]}"
        seg['burmese']=st.text_area(label, value=seg['burmese'], key=f'burmese_{i}', height=74)

if render_clicked and uploaded_video and st.session_state.segments:
    try:
        with tempfile.TemporaryDirectory(prefix='sigyi_render_') as td:
            video_path=os.path.join(td, uploaded_video.name or 'input.mp4')
            Path(video_path).write_bytes(uploaded_video.getvalue())
            logo_path=None
            if uploaded_logo:
                ext=Path(uploaded_logo.name).suffix or '.png'; logo_path=os.path.join(td,'logo'+ext); Path(logo_path).write_bytes(uploaded_logo.getvalue())
            progress=st.progress(0.0,text='TTS ပြင်ဆင်နေပါတယ်…')
            status=st.empty()
            texts=[str(s.get('burmese','')).strip() for s in st.session_state.segments]
            voice_path,timeline,total=asyncio.run(synthesize_all(texts,VOICES[voice_label],rate,td,progress,status))
            progress.progress(0.0,text='Render ပြင်ဆင်နေပါတယ်…')
            output=render_server(video_path,voice_path,st.session_state.segments,timeline,td,resolution_label,fit_mode,zoom,blur_top,blur_height,caption_y,preset,logo_path,logo_position,progress,status,brightness,contrast_adjust,saturation_adjust,blur_strength,flip,caption_color,caption_font_size)
            st.session_state.output_bytes=Path(output).read_bytes()
            st.session_state.output_name='Si-Gyi-Recap-Output.mp4'
    except Exception as e:
        st.error(str(e))

if st.session_state.output_bytes:
    st.subheader('✅ Output Preview')
    st.video(st.session_state.output_bytes)
    st.download_button('⬇️ MP4 Download', data=st.session_state.output_bytes, file_name=st.session_state.output_name, mime='video/mp4', type='primary')

st.divider()
st.caption('Privacy: Video နှင့် အသံဖိုင်များကို temporary server folder ထဲမှာ processing အတွက်သာ သိမ်းပြီး task ပြီးတဲ့အခါ ဖျက်ပါတယ်။ Streamlit server restart ဖြစ်ရင် session ထဲက output ပျောက်နိုင်ပါတယ်။')
