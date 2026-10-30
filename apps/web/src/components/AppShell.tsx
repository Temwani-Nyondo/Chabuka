import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import CreateMatchForm from './CreateMatchForm';
import CreateTeamForm from './CreateTeamForm';
import FindOpponentForm from './FindOpponentForm';

const SHEET_ITEMS = [
  { label: 'Create tournament', arrives: 'Sat 31 Oct' },
  { label: 'Ask the helper', arrives: 'Mon 2 Nov' },
];

type SheetMode = 'menu' | 'match' | 'team' | 'opponent';

export default function AppShell() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<SheetMode>('menu');

  const closeSheet = () => {
    setSheetOpen(false);
    setMode('menu');
  };
  const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'tab tab-active' : 'tab');

  return (
    <div className="app">
      <main>
        <Outlet />
      </main>
      {sheetOpen ? (
        <div className="sheet-backdrop" role="presentation" onClick={closeSheet}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Set something up"
            onClick={(e) => e.stopPropagation()}
          >
            {mode === 'match' ? (
              <>
                <h2>Create match</h2>
                <CreateMatchForm onDone={closeSheet} />
                <button className="btn btn-ghost" type="button" onClick={() => setMode('menu')}>
                  Back
                </button>
              </>
            ) : mode === 'team' ? (
              <>
                <h2>Create team</h2>
                <CreateTeamForm onDone={closeSheet} />
                <button className="btn btn-ghost" type="button" onClick={() => setMode('menu')}>
                  Back
                </button>
              </>
            ) : mode === 'opponent' ? (
              <>
                <h2>Find opponent</h2>
                <FindOpponentForm onDone={closeSheet} />
                <button className="btn btn-ghost" type="button" onClick={() => setMode('menu')}>
                  Back
                </button>
              </>
            ) : (
              <>
                <h2>Set something up</h2>
                <button className="sheet-item" type="button" onClick={() => setMode('match')}>
                  <span>Create match</span>
                  <span className="tag">Now</span>
                </button>
                <button className="sheet-item" type="button" onClick={() => setMode('opponent')}>
                  <span>Find opponent</span>
                  <span className="tag">Now</span>
                </button>
                <button className="sheet-item" type="button" onClick={() => setMode('team')}>
                  <span>Create team</span>
                  <span className="tag">Now</span>
                </button>
                {SHEET_ITEMS.map((item) => (
                  <div className="sheet-item" key={item.label}>
                    <span>{item.label}</span>
                    <span className="tag">{item.arrives}</span>
                  </div>
                ))}
                <button className="btn btn-ghost" type="button" onClick={closeSheet}>
                  Close
                </button>
              </>
            )}
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
