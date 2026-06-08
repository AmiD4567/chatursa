import { useState, useEffect } from 'react';

/**
 * Компонент превью ссылки (как в WhatsApp/Telegram).
 * Загружает Open Graph метаданные и показывает карточку с картинкой, заголовком и описанием.
 */
export default function LinkPreviewCard({ url, socketUrl }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPreview() {
      try {
        const response = await fetch(`${socketUrl}/api/link-preview?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        if (!cancelled) {
          setPreview(data);
          setLoading(false);
        }
      } catch (err) {
        console.warn('Failed to fetch link preview:', err);
        if (!cancelled) {
          // Fallback: показать минимальную карточку с доменом
          let domain = '';
          try { domain = new URL(url).hostname; } catch {}
          setPreview({ success: false, title: domain || url, url });
          setLoading(false);
        }
      }
    }

    fetchPreview();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) {
    return (
      <div className="link-preview-card loading">
        <div className="link-preview-skeleton">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-desc" />
          <div className="skeleton-image" />
        </div>
      </div>
    );
  }

  if (!preview) return null;

  const domain = preview.domain || '';
  const title = preview.title || '';
  const description = preview.description || '';
  const image = preview.image && !imageError ? preview.image : null;

  // Не показываем карточку если нет ни заголовка, ни описания, ни картинки
  if (!title && !description && !image && !preview.success) return null;

  // Обрезаем домен для отображения (убираем www.)
  const displayDomain = domain.replace(/^www\./, '');

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`link-preview-card${image ? ' with-image' : ''}`}
      onClick={(e) => e.preventDefault()}
    >
      {image && (
        <div className="link-preview-image-wrapper">
          <img
            src={image}
            alt={title}
            className="link-preview-image"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        </div>
      )}
      <div className="link-preview-content">
        {title && <div className="link-preview-title">{truncate(title, 80)}</div>}
        {description && <div className="link-preview-description">{truncate(description, 150)}</div>}
        {displayDomain && <div className="link-preview-domain">{displayDomain}</div>}
      </div>
    </a>
  );
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}
