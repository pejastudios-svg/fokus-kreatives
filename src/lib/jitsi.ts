// lib/jitsi.ts
export function createJitsiRoom() {
  const roomName = Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
  return `https://meet.jit.si/${roomName}`
}