import { useEffect, useState } from 'react';
import { getRecentStudents, type RecentStudent, clearRecentStudents } from '../lib/recentStudents';

type Props = {
  onSelect: (student: RecentStudent) => void;
  refreshKey?: number;
  title?: string;
};

export default function RecentStudents({ onSelect, refreshKey = 0, title = 'Recently used' }: Props) {
  const [items, setItems] = useState<RecentStudent[]>([]);

  useEffect(() => {
    setItems(getRecentStudents());
  }, [refreshKey]);

  if (!items.length) return null;

  return (
    <div className="recent-students mt-2">
      <div className="recent-title text-sm text-muted">{title}</div>
      <div className="recent-list">
        {items.map((s) => (
          <button
            type="button"
            className="recent-chip"
            key={`${s.email}|${s.name}`}
            onClick={() => onSelect(s)}
            title={s.email || s.year || s.name}
          >
            {s.name}
          </button>
        ))}
        <button
          type="button"
          className="recent-chip muted"
          onClick={() => {
            clearRecentStudents();
            setItems([]);
          }}
        >
          Clear recent
        </button>
      </div>
    </div>
  );
}
