The apps schools use for examinations usually fall into two categories: Lockdown Browsers (which freeze the phone so students can't switch apps) and Proctoring Platforms (which record the student via camera and AI).
Regarding the Chinese university app you likely saw, it is almost certainly Chaoxing (Learning Anywhere) or DingTalk, which became the standard for millions of students in China.
1. The "Lockdown" Industry Standard
These are the most common apps used globally that students install on their own devices:

Safe Exam Browser (SEB): This is the "gold standard" for open-source exam security. It turns a phone or tablet into a secure workstation by disabling all other functions until the exam is submitted.
Repo: GitHub - SafeExamBrowser

Respondus LockDown Browser: Widely used by universities that use Canvas, Blackboard, or Moodle. It prevents students from printing, copying, or accessing other URLs/apps.

Proctorio / ProctorU: These are often browser extensions or standalone mobile apps that use the phone's camera and microphone to watch the student in real-time.


2. The "Chinese University" Apps
In China, specialized "super-apps" handle everything from homework to high-stakes finals. The one you saw was likely:

Chaoxing (超星 / Xuexitong): This is the most dominant academic app in China. It has a built-in "Exam Mode" that uses facial recognition and prevents screen switching.

DingTalk (钉钉): Owned by Alibaba, it’s a professional communication tool that schools customized for exams. It has an "Exam" feature that can lock the mobile interface and track "leaving the screen" events.

Tencent Meeting / VooV: Often used for "dual-camera" proctoring where the student uses one phone for the exam and another phone (placed at their side) to show their hands and workspace.

3. Open-Source Repositories (For Developers)
If you are looking for code to see how these work, check these GitHub repositories:
Project	Description	Repository Link
Safe Exam Browser	The most popular open-source lockdown browser.	SEB on GitHub (iOS/macOS)
TCExam	An open-source, web-based CBT (Computer Based Testing) system.	TCExam Repo
Exam.net	While not fully open-source, it’s a high-profile web tool often used with mobile "high-security" modes.	Official Site
How they actually "lock" the phone:
On iOS, these apps use a feature called "Single App Mode" (via the Guided Access API), which requires the user's permission to lock the screen to just that app. On Android, they typically use the "Screen Pinning" API or request "Device Administrator" privileges to prevent the Home or Back buttons from working.

Since we have high-speed 5G connectivity, you can bypass the "offline-first" limitations and build a High-Fidelity Real-Time Proctoring System. This is the "actual thing" used by top-tier Chinese universities (like those using Chaoxing or Tencent Meeting) and global certification bodies.
To build this for schools in Africa, your architecture should focus on Low Latency and Computer Vision.

1. The Real-Time Architecture
You need a system that doesn't just record, but analyzes and reacts in milliseconds.

Video Streaming (WebRTC): Do not use standard HLS or DASH (too much lag). Use WebRTC for sub-second latency. This allows a human proctor to watch 50 students simultaneously with zero delay.
Tool: Agora.io or Jitsi Videobridge (Open Source).
The "Dual-Camera" Protocol: This is the Chinese standard.

Primary Camera: The phone used for the exam (Face & Eye tracking).
Secondary Device: A second phone or laptop placed at a 45° angle behind the student to show the hands, desk, and screen. Your system should sync both feeds into one dashboard for the invigilator.

2. Real-Time AI Features (The "Engine")
With 5G, you can run heavy AI models on the Edge (the phone) or the Cloud without lag.

Gaze Estimation: Detects if the student’s eyes move away from the screen for more than 3 seconds.
Library: MediaPipe Face Mesh (Real-time, works great on mobile).

Object Detection (YOLOv8): Detects unauthorized items in the frame (phones, books, or another person).

Implementation: Run a lightweight yolov8n (nano) model directly on the mobile device using TensorFlow Lite.

Audio Fingerprinting: Monitors the microphone for "human speech." It can distinguish between a car honking outside and a person whispering an answer.
 
3. The "Lockdown" Mobile Wrapper
Even with 5G, you must prevent the student from leaving the app.
Platform	Technical Implementation
Android	Use LockTaskMode. This is the "Corporate/Education" mode that disables Home, Back, and Recent Apps buttons. The user cannot exit without a "Kiosk Exit Key."
iOS	Use Guided Access or ASAM (Autonomous Single App Mode). ASAM allows your app to programmatically lock itself when the exam starts and unlock when it ends.

4. Technical Stack Recommendation
If I were building this today for 5G-enabled regions:
Mobile Framework: Flutter (Excellent performance for high-speed UI and camera manipulation).
Real-time Communication: Socket.io for instant "Violation Alerts" (e.g., if a student is flagged, the teacher's dashboard pops up red immediately).
Backend: Node.js or Go for high-concurrency (handling 10,000+ students at once).
Database: PostgreSQL for results and Redis for real-time session state.

5. Essential Repositories for "The Actual Thing"
Component	Repository / Resource
Proctoring UI	GitHub - Proctoring-System (Explore the top starred TS/JS repos).
Face Tracking	MediaPipe Examples (The foundation of eye/face tracking).
Security Layer	Safe Exam Browser Apple (Study how they handle the "Lock" logic).
The "Africa" Competitive Advantage
While 5G is available, stability can still fluctuate. To make your app superior to Chinese imports:

Adaptive Bitrate: If the 5G drops to 4G, the video should automatically downscale from 480p to 240p without dropping the connection.

Local Cloud Zones: Host your servers in local data centers (e.g., AWS Cape Town or Lagos-based providers) to keep latency under 50ms or we have to use the school datacentre
Building an examination app for the African market requires a different architectural approach than the "always-online" Chinese or Western models.
You aren't just fighting cheating; you're fighting high data costs, erratic electricity, and low-end hardware.
If you want to build this, here is the technical roadmap and the open-source building blocks you should use.
1. The Core Architecture: "Offline-First"
Most African schools (outside of major hubs like Lagos, Nairobi, or Johannesburg) cannot guarantee 100% uptime during a 2-hour exam.

The Workflow: Students download the encrypted exam file at home/school while online. The app "locks" at the start time. The student writes the exam offline. The app automatically syncs the tiny encrypted result file the next time it senses a 2G/3G connection.

Database: Use SQLite or Realm for local storage. They are lightweight and handle "sync" logic better than standard JSON files.

2. The "Lockdown" Mechanism (Technical Repos)
To prevent students from Googling answers, you need to "pin" the app.
Android (Kiosk Mode): You want to use the Android Lock Task Mode.
Logic: Your app must be set as a "Device Owner" or "Profile Owner."
Repo to Study: DPC Explorer – This is Google's official sample for device management. It shows how to lock a phone into a single app.

React Native / Flutter: If you are building cross-platform, use these wrappers:
Flutter: safe_device or kiosk_mode packages
React Native: react-native-kiosk-mode.

3. Open-Source Examination Engines
Don't build the actual "question and answer" logic from scratch. Fork these:
Safe Exam Browser (SEB): This is the gold standard for open-source exam security.
Repo: SEB for iOS
Why: It has a built-in "Browser Exam Key" that proves the student is using your secure app and not a standard Chrome browser.
Moodle Mobile: Many African universities already use Moodle. You can fork their mobile app and hardcode the security settings.
Repo: Moodle App

4. Low-Cost AI Proctoring (The "African Context" Twist)
Traditional proctoring (streaming live video to a server) is too expensive for African data rates. Instead, use Edge AI:

The Tech: Use TensorFlow Lite to run "Face Detection" locally on the phone.
How it works: Instead of streaming video, the app only triggers a "flag" if the face leaves the frame or a second face appears. It can take a low-res photo as evidence and upload that 10KB photo later.
Repo to Study: Proctor - AI Proctoring Engine. This is a lightweight JS/TS library for behavior tracking.

5. Key Challenges to Solve
Challenge	Solution
Storage	Many students have 16GB phones. Keep your app under 50MB.
Battery	Proctoring drains battery fast. Use "Interval Photos" instead of "Live Video."
Cheating	Students often use "Split Screen" mode. Your app must detect onPause() and onStop() events and automatically void the exam if the app loses focus.
Suggested Tech Stack:
Frontend: Flutter (Best for low-end Android performance).
Backend: Go or Node.js (Lightweight for hosting on local school servers).
Security: JWT for authentication and AES-256 for local exam encryption.

for the cbt, we need a system that ensures randomness of the questions so that the chances of students having the same question on the same number is low

this is going to be a system that any school can create for his school(admin view) by the mcp team

we have a standalone working biometric system that this cbt system will depend on

the cbt will handle the marking of results, exams, test and assigment submission. this way by the third module of thissystem which is the exams system we will implement in the future, the biometric and the cbt will feed information to the third system

all this systems and more are tointeract with eachother tho independent

from the biometric system, we should get
no. of students
no. of registered students
no. of students that passed for the exams
no. of those that wrote 