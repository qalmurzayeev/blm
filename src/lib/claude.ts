import { db } from './firebase'; // Firestore қолдану қажет болса
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const SYSTEM_PROMPT = `Сен BilimAI платформасының AI Кураторысың. Тек Қазақстан ҰБТ-сына байланысты сұрақтарға жауап бер.
Пәндер: математика, физика, химия, биология, Қазақстан тарихы, дүниежүзі тарихы, қазақ тілі, ағылшын тілі, география, информатика, оқу сауаттылығы, математикалық сауаттылық.
Жауаптарыңды тек қазақ тілінде бер. Қысқа, нақты, достық үнмен жаз.
Қажет болса нөмірленген тізім, формулалар мен эмодзи қолдан.
ҰБТ-ға байланысты емес сұрақтарға: "Мен тек ҰБТ сұрақтарына жауап беремін 📚" деп жауап бер.
Оқушыға мотивация бер, қателерін түсіндір, теорияны қарапайым тілмен айт.`;

const MAX_RETRIES = 3;

async function fetchWithRetry(url: string, options: RequestInit, retries: number): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    if (res.status === 503 || res.status === 429) {
      const delay = Math.min(2000 * (i + 1), 8000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

export async function askCurator(
  messages: { role: 'user' | 'assistant'; text: string }[],
  userEmail?: string // Пайдаланушы поштасын қостық (тарихты сақтау үшін)
): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    return 'API кілті орнатылмаған. .env файлына EXPO_PUBLIC_GEMINI_API_KEY қосыңыз.';
  }

  try {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    const res = await fetchWithRetry(
      `${API_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.7,
          },
        }),
      },
      MAX_RETRIES,
    );

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 503 || res.status === 429) {
        return 'Сервер қазір бос емес. 10-15 секундтан кейін қайталаңыз 🔄';
      }
      return `Қате: ${data?.error?.message ?? 'белгісіз'}`;
    }

    const aiResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const finalResult = typeof aiResponse === 'string' ? aiResponse : 'Жауап алынбады.';

    // БОЛАШАҚТА: Чат тарихын Firestore-ға сақтау логикасы
    if (userEmail && finalResult !== 'Жауап алынбады.') {
      saveChatToFirestore(userEmail, messages[messages.length - 1].text, finalResult);
    }

    return finalResult;
  } catch (e: any) {
    return `Желі қатесі: ${e?.message ?? 'қосылу мүмкін емес'}`;
  }
}

/**
 * Чат хабарламаларын Firestore-ға сақтау функциясы
 */
async function saveChatToFirestore(email: string, question: string, answer: string) {
  try {
    await addDoc(collection(db, 'chat_history'), {
      user_email: email,
      question,
      answer,
      timestamp: serverTimestamp()
    });
  } catch (e) {
    console.error("Chat сақтау қатесі:", e);
  }
}