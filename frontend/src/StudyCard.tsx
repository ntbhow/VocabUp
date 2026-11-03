import { Volume2 } from 'lucide-react';
import { speak, type Card } from './api';
import { HighlightExample } from './components';

export function StudyCard({ card, revealed, onFlip }: { card: Card; revealed: boolean; onFlip: () => void }) {
  return <div className={`study-flip ${revealed ? 'is-revealed' : ''}`}>
    <div className="study-flip-inner">
      <div className="flashcard study-face study-front" aria-hidden={revealed} inert={revealed}>
        <span className="flash-label">TỪ VỰNG</span>
        {card.imageUrl && <img className="flash-image" src={card.imageThumbnailUrl || card.imageUrl} alt={`Minh họa: ${card.front}`} onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <strong>{card.front}</strong>
        {card.pronunciation && <span className="muted">{card.pronunciation}</span>}
      </div>
      <div className="flashcard study-face study-back" aria-hidden={!revealed} inert={!revealed}>
        <span className="flash-label">ĐÁP ÁN</span><div className="flash-answer">
          <div className="flash-primary"><small>{card.translation ? 'Nghĩa tiếng Việt' : 'Định nghĩa'}</small><strong>{card.translation || card.back}</strong></div>
          {card.translation && card.back && <div className="flash-secondary"><small>Nghĩa tiếng Anh</small><span>{card.back}</span></div>}
          {card.example && <em><HighlightExample text={card.example} term={card.front} /></em>}
        </div>
      </div>
    </div>
    <button className="study-flip-hit" aria-label={revealed ? 'Xem lại từ vựng' : 'Lật thẻ để xem đáp án'} onClick={onFlip} />
    <button type="button" className="speak-button" aria-label="Phát âm từ vựng" onClick={() => speak(card.front)}><Volume2 size={20} /></button>
    <span className="study-flip-hint" aria-hidden="true">{revealed ? 'Nhấn để xem lại từ' : 'Nhấn để lật thẻ'} ↻</span>
  </div>;
}
