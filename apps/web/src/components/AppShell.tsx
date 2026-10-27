import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const SHEET_ITEMS = [
  { label: 'Create match', arrives: 'Wed 28 Oct' },
  { label: 'Find opponent', arrives: 'Fri 30 Oct' },
  { label: 'Create team', arrives: 'Fri 30 Oct' },
  { label: 'Create tournament', arrives: 'Sat 31 Oct' },
  { label: 'Ask the helper', arrives: 'Mon 2 Nov' },
];

export default function AppShell() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'tab tab-active' : 'tab');

  return (
    <div className="app">
      <main>
        <Outlet />
      </main>
      {sheetOpen ? (
        <div className="sheet-backdrop" role="presentation" onClick={() => setSheetOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Set something up"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Set something up</h2>
            {SHEET_ITEMS.map((item) => (
              <div className="sheet-item" key={item.label}>
                <span>{item.label}</span>
                <span className="tag">{item.arrives}</span>
              </div>
            ))}
            <button className="btn btn-ghost" type="button" onClick={() => setSheetOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      <nav className="tabbar">
        <NavLink to="/" end className={tabClass}>
          Home
        </NavLink>
        <NavLink to="/explore" className={tabClass}>
          Explore
        </NavLink>
        <button
          className="fab"
          type="button"
          aria-label="Set something up"
          onClick={() => setSheetOpen(true)}
        >
          +
        </button>
        <NavLink to="/teams" className={tabClass}>
          Teams
        </NavLink>
        <NavLink to="/profile" className={tabClass}>
          Profile
        </NavLink>
      </nav>
    </div>
  );
}
