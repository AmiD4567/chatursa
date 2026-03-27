const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHANGELOG_FILE = path.join(__dirname, 'CHANGELOG.md');

// Получение лога Git
function getGitLog() {
  try {
    const log = execSync('git log --pretty=format:"%h|%ad|%s|%an" --date=short', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return log.split('\n').filter(line => line.trim());
  } catch (err) {
    console.error('❌ Ошибка получения лога Git:', err.message);
    return [];
  }
}

// Парсинг коммитов
function parseCommits(log) {
  return log.map(line => {
    const parts = line.split('|');
    return {
      hash: parts[0] || '',
      date: parts[1] || '',
      message: parts[2] || '',
      author: parts[3] || ''
    };
  });
}

// Извлечение описания из сообщения
function extractDescription(message) {
  // Паттерн: vYYYYMMDD-HHMM - Тип: описание
  const versionMatch = message.match(/^v\d{8}-\d{4}\s*-\s*(?:✨\s*Feature|🐛\s*Fix|🔒\s*Security|⚡\s*Performance|📝\s*Docs|🎨\s*Style|♻️\s*Refactor|🧪\s*Tests|📝\s*Update):\s*(.+)/i);
  if (versionMatch) {
    return versionMatch[1];
  }
  
  // Паттерн: vYYYYMMDD-HHMM - описание
  const simpleMatch = message.match(/^v\d{8}-\d{4}\s*-\s*(.+)/);
  if (simpleMatch) {
    return simpleMatch[1];
  }
  
  return message;
}

// Извлечение типа изменения
function extractType(message) {
  if (message.includes('✨') || message.toLowerCase().includes('feature')) return '✨ Новая функция';
  if (message.includes('🐛') || message.toLowerCase().includes('fix')) return '🐛 Исправление';
  if (message.includes('🔒') || message.toLowerCase().includes('security')) return '🔒 Безопасность';
  if (message.includes('⚡') || message.toLowerCase().includes('performance')) return '⚡ Производительность';
  if (message.includes('📝') || message.toLowerCase().includes('docs')) return '📝 Документация';
  if (message.includes('🎨') || message.toLowerCase().includes('style')) return '🎨 Стиль';
  if (message.includes('♻️') || message.toLowerCase().includes('refactor')) return '♻️ Рефакторинг';
  if (message.includes('🧪') || message.toLowerCase().includes('tests')) return '🧪 Тесты';
  return '📝 Изменения';
}

// Форматирование версии
function formatVersion(version, date, description, type, commits) {
  let output = `## ${version} (${date})\n\n`;
  output += `### ${type}: ${description}\n\n`;
  output += `**Коммиты:**\n\n`;
  
  commits.forEach(commit => {
    output += `- \`${commit.hash}\` ${commit.message} (${commit.author})\n`;
  });
  
  output += `\n`;
  return output;
}

// Генерация CHANGELOG
function generateChangelog(commits) {
  let changelog = `# 📋 История изменений\n\n`;
  changelog += `> Автоматически сгенерировано: ${new Date().toLocaleDateString('ru-RU', { \n`;
  changelog += `  year: 'numeric',\n`;
  changelog += `  month: 'long',\n`;
  changelog += `  day: 'numeric',\n`;
  changelog += `  hour: '2-digit',\n`;
  changelog += `  minute: '2-digit'\n`;
  changelog += `})}\n\n`;
  changelog += `---\n\n`;
  
  let currentVersion = null;
  let versionCommits = [];
  let versionDate = '';
  let versionDescription = '';
  let versionType = '';
  
  commits.forEach(commit => {
    const versionMatch = commit.message.match(/^(v\d{8}-\d{4})/);
    
    if (versionMatch && versionMatch[1] !== currentVersion) {
      // Сохраняем предыдущую версию
      if (currentVersion && versionCommits.length > 0) {
        changelog += formatVersion(
          currentVersion,
          versionDate,
          versionDescription,
          versionType,
          versionCommits
        );
      }
      
      // Новая версия
      currentVersion = versionMatch[1];
      versionDate = commit.date;
      versionDescription = extractDescription(commit.message);
      versionType = extractType(commit.message);
      versionCommits = [commit];
    } else if (currentVersion) {
      versionCommits.push(commit);
    }
  });
  
  // Последняя версия
  if (currentVersion && versionCommits.length > 0) {
    changelog += formatVersion(
      currentVersion,
      versionDate,
      versionDescription,
      versionType,
      versionCommits
    );
  }
  
  return changelog;
}

// Основная логика
console.log('📊 Генерация CHANGELOG...');
console.log('');

const log = getGitLog();

if (log.length === 0) {
  console.log('⚠️  Коммиты не найдены. Сначала создайте коммиты.');
  process.exit(0);
}

const commits = parseCommits(log);
const changelog = generateChangelog(commits);

try {
  fs.writeFileSync(CHANGELOG_FILE, changelog, 'utf8');
  console.log(`✅ CHANGELOG создан: ${CHANGELOG_FILE}`);
  console.log(`📝 Всего коммитов: ${commits.length}`);
  
  // Показать превью
  console.log('');
  console.log('📄 Превью (первые 20 строк):');
  console.log('----------------------------------------');
  const lines = changelog.split('\n').slice(0, 20);
  lines.forEach(line => console.log(line));
  if (changelog.split('\n').length > 20) {
    console.log('...');
  }
  console.log('----------------------------------------');
} catch (err) {
  console.error('❌ Ошибка записи CHANGELOG:', err.message);
  process.exit(1);
}
