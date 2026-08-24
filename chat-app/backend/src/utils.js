/**
 * Общие утилиты бэкенда. Без побочных зависимостей;
 * всё, что требует db, оформлено фабрикой.
 */

// Сравнение версий вида '1.2.3' → -1 | 0 | 1
function compareVersions(v1, v2) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

// Фабрика: getPollWithVotes, привязанная к конкретному соединению БД.
// Используется при сборке истории сообщений (server.js) и в REST опросов (routes/polls.js).
function createGetPollWithVotes(db) {
  return function getPollWithVotes(pollId, userId) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return null;
    const votes = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ?').all(pollId);
    const options = JSON.parse(poll.options);
    const totalVotes = votes.length;
    const optionVotes = options.map((_, idx) => votes.filter(v => v.option_index === idx).length);
    const userVotes = db.prepare('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?').all(pollId, userId);

    const isClosed = poll.closes_at && new Date(poll.closes_at) < new Date();
    const hideResults = poll.hide_results_until_close && !isClosed;

    return {
      id: poll.id,
      chatId: poll.chat_id,
      creatorId: poll.creator_id,
      question: poll.question,
      options,
      isAnonymous: !!poll.is_anonymous,
      allowsMultiple: !!poll.allows_multiple,
      totalVotes: isClosed || !hideResults ? totalVotes : 0,
      optionVotes: isClosed || !hideResults ? optionVotes : options.map(() => 0),
      votedIndices: userVotes.map(v => v.option_index),
      createdAt: poll.created_at,
      closesAt: poll.closes_at || null,
      isClosed,
      hideResultsUntilClose: !!poll.hide_results_until_close,
      votesHidden: hideResults
    };
  };
}

module.exports = { compareVersions, createGetPollWithVotes };
