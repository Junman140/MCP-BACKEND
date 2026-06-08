# MCP CBT Platform: Architecture & Implementation Guide

This document provides a comprehensive overview of the Computer-Based Testing (CBT) platform implemented across the Go backend, React Admin Dashboard, and Flutter Mobile App. It details exactly what has been built so far, how the different components interact, and the security protocols in place.

---

## 1. System Overview & Architecture

The CBT system is a multi-tenant platform designed to function reliably in areas with intermittent internet connectivity. It uses an "offline-first" approach where assessment payloads are downloaded entirely before the exam begins, allowing students to complete them without a constant connection.

### The Three Modules
1. **Biometric System:** Handles identity verification and attendance (Standalone, already working).
2. **CBT System:** The core testing engine that delivers assessments, enforces security, and collects submissions (What we've just built).
3. **Exams Management System:** A future module that will consume data from both to provide high-level analytics.

### Data Flow
1. **Admin creates an assessment** (Exam, Test, or Assignment) with specific rules and questions via the React dashboard.
2. **Backend encrypts and packages** the assessment into a `.mcp` zip archive containing `exam_data.json` and associated media files (images).
3. **Mobile App downloads** the encrypted `.mcp` file, decrypts it locally using AES-GCM, and renders the exam offline.
4. **Student submits answers** which are queued locally on the device via Hive.
5. **Mobile App syncs** the answers back to the Go backend automatically whenever an internet connection is available.
6. **Admin reviews submissions** and assigns manual grades via the CBT Marking interface.

---

## 2. Assessment Types (Exams, Tests, & Assignments)

The system now supports three distinct types of assessments, each with different default rules and allowed question formats.

### Assessment Rules
Every assessment has a set of `rules` configured by the admin:
*   `is_proctored` (boolean): Determines if strict lockdown and monitoring are enforced.
*   `max_attempts` (integer): Determines how many times a student can submit the assessment.

### 1. Exams
*   **Default Rules:** `is_proctored: true`, `max_attempts: 1`.
*   **Purpose:** High-stakes, timed assessments.
*   **Behavior:** The mobile app enforces the Snitch Protocol (strict lockdown).
*   **Typical Questions:** Multiple Choice Questions (MCQ).

### 2. Tests
*   **Default Rules:** `is_proctored: false`, `max_attempts: 2` (or more).
*   **Purpose:** Low-stakes quizzes, practice runs, or formative assessments.
*   **Behavior:** The Snitch Protocol is typically disabled, allowing students more flexibility.
*   **Typical Questions:** MCQ, short essays.

### 3. Assignments
*   **Default Rules:** `is_proctored: false`, typically untimed.
*   **Purpose:** Homework or projects requiring extensive writing or file uploads.
*   **Behavior:** Proctoring is disabled.
*   **Typical Questions:** Essay (with word limits), File Upload (with constraints on MIME types, file size, and max files).

---

## 3. Question Types & Media Support

The platform supports three core question types, dynamically rendered by the Flutter app.

1.  **Multiple Choice (MCQ):**
    *   Supports shuffling of both question order and option order.
    *   Backend validates against the hidden `correct_opt_id`.
2.  **Essay:**
    *   Provides a multi-line text input on mobile.
    *   Enforces an admin-defined `word_limit`.
    *   Displays a real-time word counter to the student, turning red if they exceed the limit.
3.  **File Upload:**
    *   Allows students to upload documents or images (e.g., a photo of handwritten math work or a PDF report).
    *   Admins can configure `max_files`, `max_bytes`, and `allowed_mime_types`.
    *   Uses native file pickers on the mobile device.

**Media Support:**
All question texts support **Markdown** for rich text formatting and **LaTeX** (wrapped in `$$...$$`) for rendering complex mathematical equations natively without needing bandwidth-heavy images.

---

## 4. Security & Lockdown (The "Snitch Protocol")

Since the platform operates on Bring Your Own Device (BYOD), standard Mobile Device Management (MDM) is not possible. Security is enforced at the application level.

### The Snitch Protocol Implementation
The `SnitchProtocol` is a Flutter mixin applied to the `ExamScreen`.
*   **Conditional Activation:** It checks `snitchEnabled` (`_exam?.rules.isProctored`). If the assessment is a Test or Assignment with proctoring disabled, the Snitch Protocol sleeps.
*   **App Lifecycle Monitoring:** It listens to OS-level state changes (`AppLifecycleState`).
*   **Focus Loss Detection:** If the student minimizes the app, opens split-screen, pulls down the notification shade to read a WhatsApp message, or switches to a browser (triggering `paused` or `inactive` states), a violation is immediately flagged.
*   **Violation Handling:**
    *   The violation count is incremented.
    *   A local warning is shown to the student.
    *   *(Future)*: A telemetry heartbeat is sent to the `/api/v1/telemetry` endpoint alerting the invigilator dashboard in real-time.
    *   *(Future)*: After X violations, the app can automatically force-submit the exam.

### Payload Encryption
*   Exam payloads are never sent as raw JSON over the wire.
*   The Go backend packages them into a ZIP archive and encrypts them using **AES-GCM** before transmission.
*   The mobile app decrypts the `.mcp` file entirely in memory/local storage right before the exam starts, ensuring students cannot inspect network traffic to find the correct answers. (Note: The `correct_opt_id` is also completely omitted from the payload sent to the student).

---

## 5. Offline-First Sync & Submissions

The system is designed to handle total internet failure during an exam gracefully.

### Mobile Offline Queue (Hive)
*   **`SyncService.dart`:** Every time a student selects an MCQ option, types a word in an essay, or selects a file, the answer is immediately saved to a local NoSQL database (`Hive`).
*   This means if the app crashes or the phone dies, no progress is lost.

### Background Syncing
*   The `SyncService` maintains a queue of pending submissions (answers, essays, and file references).
*   It continuously attempts to sync these to the Go backend.
*   If the request fails (no internet), it keeps the data in the queue.
*   When internet is restored, it automatically flushes the queue, sending standard answers via JSON and uploading files via multipart form data (`POST /api/v1/exams/:id/upload`).

### Backend Submission Handling (`submissions_v2`)
*   The Go backend groups all of a student's answers for a specific assessment into a single `Submission` document in MongoDB.
*   It tracks the `attempt` number and the current `status` (`in_progress`, `submitted`, `graded`).
*   File uploads are saved to local server storage (e.g., `./uploads/assignments`), and a reference (`storage_key`) is pushed into the student's submission document.

---

## 6. Admin Dashboard & Marking

The React admin interface provides comprehensive tools for managing the CBT lifecycle.

### CBT Management (`CBTExams.tsx`)
*   **Assessment Builder:** Admins can create Exams, Tests, or Assignments.
*   **Rule Configuration:** They can toggle "Proctored" status, set Durations, and define Max Attempts.
*   **Question Builder UI:** A dynamic form allows admins to add MCQs (with options), Essays (with word limits), and File Upload prompts directly in the browser.
*   **Payload Generation:** The backend immediately packages these configurations into encrypted payloads ready for download.

### CBT Marking (`CBTMarking.tsx`)
*   **Submission Review:** A dedicated interface where teachers can select an assessment and view all student submissions.
*   **Status Tracking:** Shows whether a student is `in_progress`, has `submitted`, or is already `graded`.
*   **Manual Grading:** Teachers can click "Grade" on any submission to input a `total_score` and provide written `feedback`.
*   This triggers a `PATCH` request to the backend, updating the submission status to `graded` and storing the teacher's evaluation.

---

## Summary of Tech Stack

*   **Backend:** Go (Gin, MongoDB driver, standard crypto/archive libraries).
*   **Admin Frontend:** React (Vite, TailwindCSS, Lucide Icons).
*   **Mobile App:** Flutter (Dio for networking, Hive for local offline storage, flutter_math_fork for LaTeX, file_picker for assignments).
