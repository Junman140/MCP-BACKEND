# Mobile CBT Platform: Architecture & Best Practices

This document outlines the core architecture, security protocols, and integration best practices for the Mobile Computer-Based Testing (CBT) platform. It incorporates decisions made for network availability, BYOD (Bring Your Own Device) restrictions, and system modularity.

## 1. System Scope & Multi-Tenant Architecture
- **Comprehensive Assessment:** The system is not just for exams; it handles **Exams, Tests, and Assignment Submissions**.
- **SaaS Model (Multi-tenant):** Designed so the MCP team can provision an isolated **Admin View** for any school. Each school will manage its own students, exams, and results independently on the same infrastructure.
- **Modularity:** The ecosystem is divided into independent but communicating modules:
  1. **Biometric System** (Standalone, currently working)
  2. **CBT System** (Currently in development)
  3. **Examinations Management System** (Future module for advanced tracking and analytics)

## 2. Network & Connectivity Strategy
Based on the assumption that students will have stable **3G/4G internet access**:
- **Real-Time Sync:** Exams are downloaded seamlessly at the start time.
- **Continuous Telemetry:** The app sends continuous "heartbeats" (small data packets) to the server to prove the student is still online and actively in the exam interface.
- **Auto-Submission:** Answers are synced in real-time as the student clicks. If the internet drops momentarily, it caches the answer locally and pushes it the second the connection returns.

## 3. App Lockdown for BYOD (No MDM)
Since schools are not providing the devices (Bring Your Own Device), Mobile Device Management (MDM) is too invasive and impractical. Instead, we use **Application-Level Lockdown**:

- **App Lifecycle Monitoring (The "Snitch" Protocol):** We monitor OS-level events. If the app loses focus (`onPause`, `onStop`, or `applicationDidEnterBackground`), the system flags it. 
- **Split-Screen & Screen Recording Detection:** The app explicitly disables screen recording/casting and prevents split-screen mode.
- **Screen Pinning (Android):** The app requests the user to "Pin" the screen at the start of the exam. If unpinned, the exam auto-locks.
- **Strict Penalty System:** If a student switches apps (e.g., to Google or WhatsApp), the exam can be configured to either warn them (for low-stakes tests) or immediately void/submit the exam (for high-stakes exams).

## 4. Proctoring & Camera Implementation
Since video streaming is bandwidth-heavy and sometimes ineffective for certain angles:
- **Lightweight Edge AI:** Instead of streaming video, the app uses on-device AI (like TensorFlow Lite) to do basic face detection.
- **Event-Driven Snapshots:** It only captures and uploads a small, compressed photo (e.g., 20KB) if a violation occurs, such as:
  - No face detected for > 5 seconds.
  - Multiple faces detected.
- This saves data and battery while still providing evidence of malpractice.

## 5. Question Randomization Engine
To prevent adjacent cheating (students looking at each other's screens):
- **Seed-Based Randomization:** Every student receives the exact same pool of questions, but the system shuffles both the **Question Order** (Q1 for Student A is Q15 for Student B) and the **Option Order** (Option A for Student A is Option C for Student B).
- **Difficulty Parity:** If the school uses question banks, the system randomly pulls an equal number of easy, medium, and hard questions per student.

## 6. Biometric System Integration & The "Handshake"
The Biometric system acts as the ultimate source of truth for identity and attendance. It feeds critical data (Total Students, Registered Students, Passed Biometrics, Wrote Exam) to the CBT and Exam modules.

### How the Handshake Works (Understanding Deep Links vs. Cloud)
Since the systems are independent, they need a secure way to pass the student's verified identity to the CBT app.

**Approach 1: The Cloud Sync (Best Practice & Primary Method)**
1. Student verifies their face on the Biometric System.
2. The Biometric System sends a secure token to the Cloud Database: *"Student X is verified for Exam Y"*.
3. The student opens the CBT app. The CBT app checks the Cloud, sees the verified token, and immediately unlocks the exam.
*Fallback:* If the internet fails, this can be done over a local school LAN via a local API endpoint.

**Approach 2: Deep Linking (App-to-App Communication)**
If both apps are on the same phone, Deep Linking is the bridge.
* **What is a Deep Link?** It's a custom URL that opens an app instead of a website. For example, clicking a `twitter://` link opens the Twitter app.
* **How it works here:** 
  1. Student opens the Biometric app and scans their face.
  2. The Biometric app generates a secure link: `mcp-cbt://auth?student_id=123&token=ABC`
  3. The Biometric app automatically "clicks" this link, which instantly closes the Biometric app, opens the CBT app, passes the secure token in the background, and starts the exam.

## 7. Future-Proofing (The 3rd Module)
All interactions are built using secure REST APIs or GraphQL. When the 3rd module (Exams Management System) is built, it will simply subscribe to the data feeds already being generated by the Biometric and CBT systems, allowing for high-level administrative dashboards and analytics without rewriting core logic.

 ## 8. Technology Stack & Implementation Plan
Our technology stack is specifically chosen to prioritize performance, low resource consumption, and the ability to operate in challenging environments.

### Recommended Stack
- **Mobile App:** Flutter
  - *Why:* Provides excellent cross-platform performance. It has strong community support for OS-level integrations (like Kiosk mode/Screen Pinning wrappers) and integrates seamlessly with TensorFlow Lite for our on-device Edge AI requirements.
- **Admin System:** React + Vite
  - *Why:* Lightweight, fast to build, and matches the technology used in the Biometric System. Provides a high-fidelity web interface for school administrators to manage exams, monitor proctoring flags, and view results.
- **Backend API:** Go (Golang)
  - *Why:* Go provides incredible concurrency handling and an extremely low memory footprint. This is crucial because it allows the system to easily scale in the cloud, but also makes it perfectly suited to run on low-resource local servers physically installed inside schools if they suffer from severe internet outages.
- **Local Mobile Database:** MongoDB / Realm
  - *Why:* We need a robust local database to handle the "Offline-first" sync queue. Using a NoSQL document database allows for flexible storage of encrypted exam payloads and user states, syncing seamlessly when the connection is restored.

### Implementation Phases
1. **Phase 1: Foundation & CBT Core**
   - Setup Go backend architecture and multi-tenant admin dashboards.
   - Develop Flutter mobile application with core question rendering, randomization engine, and offline-first data caching.
2. **Phase 2: Lockdown & Security**
   - Implement the "Snitch Protocol" (App Lifecycle monitoring).
   - Integrate Kiosk mode/Screen Pinning for Android.
   - Implement Edge AI face detection using TensorFlow Lite.
3. **Phase 3: Integration**
   - Establish the Cloud Sync and Deep Linking handshakes with the existing Biometric system.
   - Finalize the auto-submission and telemetry sync logic.
4. **Phase 4: Advanced Modules**
   - Begin architecture for the 3rd module (Examinations Management System) consuming data from Biometric and CBT services.

## 9. Lessons from Existing Systems (SEB, WebRTC, etc.)
To build a world-class platform, we must integrate the lessons learned from industry leaders:

- **From Safe Exam Browser (SEB):**
  - *Browser Exam Key (BEK):* SEB generates a unique hash based on the app's code and configuration. The backend only accepts exam submissions if the request includes this exact hash. We must implement a similar "App Attestation" to ensure students aren't submitting HTTP requests via Postman or a modified app.
  - *Process Monitoring:* SEB actively kills unauthorized background processes. While OS limits on mobile prevent full process killing, we can learn from their strict white-listing approach.
- **From WebRTC (Real-Time Communication):**
  - *UDP over TCP:* If we ever implement live features (like the continuous telemetry heartbeat), we should learn from WebRTC's use of UDP. Sending small, fast packets where occasional packet loss is acceptable is better than the heavy overhead of TCP for real-time status updates.
- **From Moodle Mobile:**
  - *Content Packaging:* Moodle handles offline learning by downloading ZIP packages of content. Our exam payloads should be heavily compressed and encrypted single files, rather than making multiple API calls for different questions or images.
- **From Chinese Kiosk Apps (Chaoxing):**
  - *Extreme Fault Tolerance:* They assume the user will try to break the app by rapidly pressing buttons, rotating the screen, or pulling down notification shades. Our UI must intercept and neutralize edge-swipe gestures and hardware button presses as much as the OS allows.

## 10. Exam Payload & Data Structure
To ensure that students can download the entire exam quickly even on poor networks (keeping the payload strictly under 5MB), we must optimize how questions, images, and math equations are structured and transmitted.

### The Content Packaging Strategy (The Encrypted Archive)
Instead of sending raw JSON with bloated Base64-encoded images over the API, the backend generates an **Encrypted ZIP archive** (e.g., `exam_payload.mcp`).
- **Why:** Zipping compresses text files significantly. Keeping images as binary files inside the folder structure avoids the ~33% size inflation caused by Base64 encoding.
- **Structure inside the archive:**
  ```text
  /exam_123
    ├── exam_data.json
    └── /media
         ├── img_01.webp
         └── img_02.webp
  ```

### Handling Complex Content (Images & Math)
1. **Images (WebP):** All uploaded images must be automatically converted to **WebP format** on the Go backend before packaging. WebP provides high quality at a fraction of the size of JPEG/PNG (typically 10-30KB per image). Even an exam with 100 images would only consume ~1.5MB to 3MB.
2. **Math Equations (LaTeX):** **Do not use images for math.** Math equations must be stored as **LaTeX** strings inside the JSON. The Flutter frontend will use a local rendering engine (like `flutter_math_fork`) to draw the equations natively. This consumes almost zero bandwidth (just a few bytes of text per equation).
3. **Rich Text (Markdown):** Use lightweight Markdown instead of heavy HTML tags for formatting (bold, italics, etc.) to keep the JSON size microscopic.

### The JSON Schema (`exam_data.json`)
The JSON structure separates content from presentation and supports dynamic media loading.

```json
{
  "exam_id": "uuid-1234",
  "metadata": {
    "title": "Midterm Mathematics",
    "duration_minutes": 120,
    "shuffle_questions": true,
    "shuffle_options": true
  },
  "questions": [
    {
      "q_id": "q-001",
      "type": "multiple_choice",
      "content": "Solve for x: $$x^2 - 4x + 4 = 0$$. Refer to the diagram below.",
      "media": ["media/img_01.webp"],
      "options": [
        { "opt_id": "opt-a", "text": "$$x = 2$$" },
        { "opt_id": "opt-b", "text": "$$x = -2$$" },
        { "opt_id": "opt-c", "text": "$$x = 4$$" }
      ]
    }
  ]
}
```
*(Security Note: Notice that `correct_opt_id` is intentionally omitted from the student's payload. Grading should happen strictly on the backend after the student submits their answers, ensuring no one can reverse-engineer the exam file to cheat).*
