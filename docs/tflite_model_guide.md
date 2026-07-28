# TFLite Model Bundling Guide

The CBT app uses on-device TensorFlow Lite models for face detection, gaze estimation, and audio classification. This keeps proctoring data local and minimal — only violation snapshots (<20KB) are uploaded, never live video.

## Required Models

### 1. Face Detection: `blaze_face_short_range.tflite`
- Source: MediaPipe BlazeFace (short-range variant, optimized for front-facing phone cameras)
- Size: ~200KB
- Input: 128x128 RGB image
- Output: Bounding boxes + 6 facial keypoints per face
- Place in: `assets/models/blaze_face_short_range.tflite`

### 2. Gaze Estimation: `mediapipe_face_mesh.tflite`
- Source: MediaPipe Face Mesh
- Size: ~3.4MB
- Input: 192x192 RGB image
- Output: 468 3D face landmarks (includes eye landmarks for gaze direction)
- Place in: `assets/models/face_landmark.tflite`

### 3. Audio Classification (Optional): `yamnet_classification.tflite`
- Source: YAMNet (TensorFlow Audio Models)
- Size: ~900KB
- Input: 0.96-second audio frames at 16kHz
- Output: 521 audio event classes (can filter for speech/whisper)
- Place in: `assets/models/yamnet.tflite`

## Bundling in Flutter

Add to `pubspec.yaml`:
```yaml
flutter:
  assets:
    - assets/models/blaze_face_short_range.tflite
    - assets/models/face_landmark.tflite
    - assets/models/yamnet.tflite
```

## TFLite Inference (in ProctoringServiceV2)

```dart
import 'package:tflite_flutter/tflite_flutter.dart';

class FaceDetector {
  Interpreter? _interpreter;

  Future<void> loadModel() async {
    _interpreter = await Interpreter.fromAsset('assets/models/blaze_face_short_range.tflite');
  }

  List<FaceBox> detect(CameraImage image) {
    // Preprocess image to 128x128 RGB
    // Run inference
    // Parse output tensors for boxes + keypoints
    // Return list of detected faces
  }
}
```

## Minimum Setup

If you can't include the large face mesh model (3.4MB), use only BlazeFace (200KB). It detects whether:
- 0 faces = student left the frame
- 1 face = normal
- 2+ faces = unauthorized person present
