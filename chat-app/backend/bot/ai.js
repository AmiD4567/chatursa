const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const AI_MODEL = process.env.AI_MODEL || 'qwen2.5:3b';
const AI_TIMEOUT = 30000;

const SYSTEM_PROMPT = `Ты — корпоративный помощник ChatUrsa в компании.
Отвечай кратко, по делу, на русском языке.
У тебя нет доступа к файлам, командам, инструментам и функциям системы.
Ты не можешь выполнять никаких действий, кроме генерации текста.
Не предлагай открыть файлы, выполнить команды или запустить функции.
Если тебя просят сделать что-то, выходящее за рамки текстового ответа, вежливо откажись.
Если вопрос не по работе — ответь, что ты корпоративный помощник и можешь помочь только с рабочими вопросами.`;

async function queryOllama(messages) {
  const url = `${OLLAMA_HOST}/api/chat`;
  const body = {
    model: AI_MODEL,
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.message?.content?.trim() || '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('AI: таймаут ожидания ответа от модели');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getAiResponse(userText, history = []) {
  const messages = [];

  for (const msg of history.slice(-6)) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.text || msg.content || '' });
    }
  }

  messages.push({ role: 'user', content: userText });

  try {
    const answer = await queryOllama(messages);
    return {
      text: answer,
      buttons: []
    };
  } catch (err) {
    console.error('Ошибка AI:', err.message);
    return null;
  }
}

module.exports = { getAiResponse, SYSTEM_PROMPT };
