import ComingSoon from '../components/ComingSoon';

const SHELLS: { title: string; hint: string }[] = [
  { title: 'Entry fees', hint: 'A fee field on tournament creation with a "Pay entry fee" button.' },
  { title: 'Fundraising', hint: 'A progress bar on the tournament page with a cost breakdown.' },
  { title: 'MVP & stat badges', hint: 'A match MVP tag and badges on seeded profiles.' },
  { title: 'Ticketing', hint: 'Ticket types on the tournament board and a sample QR ticket screen.' },
  { title: 'League tab', hint: 'On the board, reusing the fixtures and standings layout.' },
  { title: 'Hall of Fame', hint: 'One page for a seeded past tournament.' },
  { title: 'Discipline', hint: 'Yellow and red card icons on fixture results.' },
  { title: 'Verified badge', hint: 'On seeded corporate teams.' },
];

export default function RoadmapPage() {
  return (
    <div className="page">
      <h1>Coming next</h1>
      <p className="muted">Preview shells: the roadmap, clearly labelled as not working yet.</p>
      {SHELLS.map((s) => (
        <ComingSoon key={s.title} title={s.title} hint={s.hint} />
      ))}
    </div>
  );
}
