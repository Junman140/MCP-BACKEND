# MCP Ecosystem: Unified Startup Guide

This guide explains how to start the entire MCP Biometric and CBT management system using the new structured layout.

---

## 1. Prerequisites
- **MongoDB:** Running locally on `mongodb://localhost:27017`.
- **Go:** For the CBT Backend.
- **Node.js & pnpm:** For the APIs and Frontend.
- **JDK 17+ & Maven:** For the Matching Service.
- **Python:** For the Capture Bridge.

---

## 2. One-Time Setup
Run this once to install all dependencies for all services and frontends.
```powershell
pnpm install:all
```

---

## 3. Starting the System (Two Steps)

### Step 1: Start All Backend Services & Bridges
This command launches the Biometric API, CBT Backend, Matching Service, and Capture Bridge concurrently.
```powershell
pnpm dev:services
```
- **Biometric API:** Port 4000
- **CBT Backend:** Port 8080
- **Matching Service:** Port 5050
- **Capture Bridge:** Port 5000

### Step 2: Start the Unified Admin Dashboard
This command launches the React-based management dashboard.
```powershell
pnpm dev:frontend
```
- **Unified Admin UI:** `http://localhost:5173`
- **Login:** Use existing credentials (e.g., `admin@example.edu` / `SecurePass1`).
- **Access:** The "CBT Exams" tab is integrated into the sidebar.

---

## 4. Mobile CBT App
For student exam delivery (Flutter).
```powershell
cd mobile/cbt_mobile
flutter run
```

---

## 5. Summary of Service Ports
| Service | Port | Description |
| :--- | :--- | :--- |
| **Admin UI** | 5173 | Unified management for both Biometrics and CBT |
| **Biometric API** | 4000 | Core identity and tenant management |
| **CBT Backend** | 8080 | Exam packaging and secure delivery |
| **Matching Service**| 5050 | High-speed fingerprint matching (Java) |
| **Capture Bridge** | 5000 | Hardware bridge for fingerprint scanners |

---

## 6. Directory Structure
- `services/`: All backend microservices (Go, Node, Java, Python).
- `frontend/`: All web-based user interfaces.
- `mobile/`: Flutter mobile applications.
- `packages/`: Shared code used across services.
- `scripts/`: Utility and startup scripts.
- `docs/`: Project documentation.
