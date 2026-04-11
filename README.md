# KIARA - Personal Assistant Intelligent System

KIARA is a high-performance, private personal assistant designed for real-time voice interaction, structured memory management, and intelligent call analysis. Built with a focus on privacy, all sensitive user data is stored exclusively in your private Firebase database.

## Key Features

### 🎙️ Real-Time Voice Interaction
- **Voice-to-Voice**: Natural conversation with low-latency response.
- **Adaptive Persona**: Kiara adapts her personality (Sassy, Romantic, Cool, Professional, Normal) and voice gender based on user preferences.
- **Wake Word Detection**: Hands-free interaction capability.

### 🧠 Structured Intelligence Hub
- **"Memorize it"**: High-precision memorization that extracts core facts into structured JSON format.
- **Knowledge Base**: A searchable datatable of all your stored insights, ideas, and personal notes.
- **Semantic Search**: Find memories based on meaning, not just keywords.

### 📱 Mobile Action Integration (Simulated)
- **Call Analysis**: Automatically detects ended calls and offers to analyze the transcript.
- **Insight Extraction**: Extracts summaries, context, and actionable reminders from call recordings.
- **Calendar Sync**: Automatically creates reminders and alerts from conversations and calls.

### 🔒 Privacy & Data Policy
- **Local Control**: KIARA uses advanced AI models as a processing engine, but **never** syncs your data with Google services like Gmail, Drive, or Google Calendar.
- **Private Database**: All your sensitive information—transcripts, memories, and reminders—is stored directly in your **Firebase Database**.
- **No External Training**: Your personal data is used only to serve you and is not used for training external models or shared with third-party servers beyond the immediate processing required for your requests.

## Technical Stack
- **Frontend**: React 18, Vite, Tailwind CSS, Framer Motion.
- **Backend**: Firebase (Firestore, Authentication).
- **AI Engine**: Advanced Multimodal Models for voice, text, and embeddings.

## Getting Started
1. **Login/Register**: Create your private profile.
2. **Wake Kiara**: Tap the power button or use the wake word.
3. **Manage Intelligence**: Use the Message icon to view your Intelligence Hub.
