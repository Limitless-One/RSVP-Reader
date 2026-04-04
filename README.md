# RSVP-Reader

A lightweight browser extension for Rapid Serial Visual Presentation (RSVP) reading that is fast, customizable, fully open-source, and completely local.

## Demo

<p align="center">
  <img src="RSVP Reader Demo.gif" alt="RSVP Reader Demo">
</p>

## ⚡ Quick Start
1. Download `/dist`
2. Load unpacked extension from your browser
3. Start reading

## Why I Built This

This was a weekend project, after I came across RSVP apps. I found them useful, but often limited in customization and a hassle to copy paste every chapter. So I decided to build my own for myself, as an extension, which automatically parses supported pages. Though I vibe coded this extension, I put quite a bit of thought and research into features that could be useful and did my due diligence to make sure there weren't any major vulnerabilities. However, if I missed any, do let me know, and I'll try to patch it.

---

## License

MIT License  

You are free to use, modify and share the source code.  
But if you find it useful, do give me a shout out and share it with other users.

---

## What is RSVP?
Rapid Serial Visual Presentation is a speed reading technique that can improve your reading speed and focus, letting you finish longer novels in a shorter time. The basic idea is that one chunk of words is displayed at a fixed position (usually the center) and automatically progresses at the specified rate. So instead of you moving your head, along the line, you just pay attention to one spot and the words move instead.

---

## 🧩 Installation

There are two ways to use the extension:

1. Build from source  
2. Use the prebuilt `/dist` folder (recommended for most users)

---

### 🔨 Build from Source

**1. Download / Clone the project from Github:**
```bash
git clone github.com/Limitless-One/RSVP-Reader/
```
**2. Go to the project directory in your Terminal by using cd Path_to_the_Directory:**
```bash
cd <project-directory>
```
**3. Run the command:**
```bash
npm install
```
**4. Run the command:**
```bash
npm run build
```
This will generate a /dist directory in the project directory.

---

### Loading the '/dist' as an Extension:

1. **Open your browser.**  
   Works on Chromium-based browsers (Chrome, Brave, Edge, etc).  
   *Not supported on Safari.*

2. **Go to the extensions page:**  
   - `chrome://extensions/` (Google Chrome)  
   - `brave://extensions/` (Brave)  
   - `edge://extensions/` (Microsoft Edge)  

3. **Turn on developer mode**, usually at the top right corner.  

4. **Click on "Load Unpacked".**  

5. **Select the `/dist` folder.**
   
These instructions are accurate as of April 2026, but can change over time.

Note: Sometimes, if there's an error loading it, try rebuilding the /dist once again by running:
```bash
npm run build
```

---

# ✨ Features

## Core Features
- Automatic parsing of page content
- Offline support (for previously loaded pages)
- Customization options
- Adaptive pacing
- Bookmarks
- Session analytics

## Advanced Features
- User-based adaptive pacing (experimental)
- ADHD-friendly reading tools
- Support for most major web novel sites
- Non-English language support
- Google Translate compatibility
- Built-in ad blocking

> If your favorite site isn’t supported, feel free to request it!

---

# ⚙️ Customization

Access settings via:  
- **Extension menu** (`⋮ → Options`)  
- **Reader UI** (sun icon)  

### ▶️ Playback
- Reading Speed  
- Speed Step  
- Chunk Size (words per display)  
- Warmup Ramp (gradual acceleration)  
- Adaptive Pacing: slows down for punctuation, numbers, long words; faster for stop words  
- Sentence Mode  
- Skip Author Notes  
- Punctuation Pause (custom per type)  

### 🎨 Display
- Font  
- Font Size  
- Theme  
- Text Color  
- Background Color  
- Background Image  

### 🧠 ADHD Features
- Bionic Reading (bolds first ~45% of words)  
- ORP Guide (Optimal Recognition Point line)  
- Guide Line Color  
- Session Stats  
- Highlight Current Paragraph  

### 🌐 Supported Pages
- Follow translated page text position  
- Site-specific parser controls  
- Favorite frequently used sites  

> Check **Supported Pages** for the latest list.

### ⌨️ Keyboard Shortcuts
**Default shortcuts:**  
- `< / >` → Previous / Next chunk  
- Scroll → Adjust speed  
- Backspace → Skip back 5 seconds  
- Esc → Close reader  
- Click / Space → Play / Pause  

### 🧬 Personalization
- Optional local model for adaptive reading speeds  
- Learns based on text type, reading behavior, time, etc.  
> Note: This is still experimental and may not perform perfectly.

### 🔖 Bookmarks
- Automatically saved  
- Resume from last position  
- Can be managed or deleted  

### 🛠️ Advanced
- Import settings  
- Export settings  

---

## Known Limitations
- Not supported on Safari  
- Some sites may break parsing, particularly Wordpress sitess as the specific format may vary

