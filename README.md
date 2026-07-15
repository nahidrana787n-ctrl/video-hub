# রিলহাব — GitHub-এ আপলোড ও হোস্ট করার নিয়ম

এই সাইট স্ট্যাটিক (HTML/CSS/JS), তাই GitHub-এ রেখে **GitHub Pages**-এ ফ্রি হোস্টও করে ফেলা যায়।

## ১) GitHub-এ অ্যাকাউন্ট ও রিপোজিটরি
1. https://github.com -এ অ্যাকাউন্ট না থাকলে খুলে নিন।
2. উপরে ডানদিকে **+** → **New repository**।
3. নাম দিন (যেমন `reelhub`), Public সিলেক্ট করুন, **Create repository**।

## ২) ফাইল আপলোড (ব্রাউজার থেকে, সহজ পদ্ধতি)
1. নতুন খোলা রিপোজিটরি পেজে **"uploading an existing file"** লিংকে ক্লিক করুন।
2. এই zip থেকে বের করা `user-website` ফোল্ডারের ভেতরের **সব ফাইল ও ফোল্ডার** (`index.html`, `css/`, `js/` ইত্যাদি) টেনে এনে ছেড়ে দিন (drag & drop)।
   - খেয়াল রাখবেন `user-website` ফোল্ডারটা যেন রিপোর ভেতরে আরেকটা সাব-ফোল্ডার হিসেবে না ঢোকে — `index.html` রিপোর একদম রুটে (মূল পাতায়) থাকতে হবে।
3. নিচে "Commit changes" বাটনে ক্লিক করে আপলোড শেষ করুন।

## ৩) কমান্ড লাইন থেকে (যদি Git ইনস্টল থাকে)
```bash
cd user-website
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<আপনার-ইউজারনেম>/reelhub.git
git push -u origin main
```

## ৪) ফ্রি হোস্টিং — GitHub Pages চালু করা
1. রিপোজিটরিতে যান → **Settings** → বামের মেনু থেকে **Pages**।
2. **Source** → "Deploy from a branch" সিলেক্ট করুন।
3. **Branch** → `main` এবং ফোল্ডার `/ (root)` সিলেক্ট করে **Save**।
4. ১-২ মিনিট পর একটা লিংক পাবেন, যেমন:
   `https://<আপনার-ইউজারনেম>.github.io/reelhub/`
   — এটাই আপনার লাইভ সাইট।

## পরে কোনো ফাইল বদলালে
- ব্রাউজার থেকে: ওই ফাইলে গিয়ে ✏️ (pencil) আইকনে ক্লিক করে এডিট করে Commit করুন।
- কমান্ড লাইন থেকে:
```bash
git add .
git commit -m "update"
git push
```

## গুরুত্বপূর্ণ — Firebase নিরাপত্তা
`js/firebase-config.js` ফাইলে থাকা `apiKey` পাবলিক রিপোতে দেখা যাবে — এটা স্বাভাবিক, Firebase-এর ওয়েব apiKey গোপন রাখার জিনিস না। তবে অবশ্যই Firebase Console-এ গিয়ে:
- **Firestore → Rules** ঠিকভাবে সেট করুন (যাতে যে কেউ ডেটা মুছে/বদলে ফেলতে না পারে)।
- **Authentication → Settings → Authorized domains**-এ আপনার `xxx.github.io` ডোমেইনটা যোগ করে দিন, নাহলে লগইন/রেজিস্ট্রেশন কাজ করবে না।
