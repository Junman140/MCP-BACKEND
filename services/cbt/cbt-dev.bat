@echo off
set MONGODB_URI=mongodb://localhost:27017/school
set JWT_SECRET=0123456789abcdef0123456789abcdef
set ENCRYPTION_KEY=this-is-a-32-byte-long-key-1234
set BIOMETRIC_API_URL=http://127.0.0.1:4111
set OLLAMA_URL=http://localhost:11434
set OLLAMA_MODEL=gemma3:1b
go run cmd/server/main.go
