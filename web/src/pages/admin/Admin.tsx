import { useParams } from 'react-router-dom';
import Users from './Users';
import { Banks, Companies, Lists, Modes, Statuses } from './Masters';
import { Matrix, Roles, Templates } from './Rules';
import { Backup, Logins, Outbox, Settings } from './System';

export default function Admin() {
  const { section } = useParams();
  switch (section) {
    case 'users': return <Users />;
    case 'roles': return <Roles />;
    case 'companies': return <Companies />;
    case 'banks': return <Banks />;
    case 'matrix': return <Matrix />;
    case 'modes': return <Modes />;
    case 'lists': return <Lists />;
    case 'statuses': return <Statuses />;
    case 'templates': return <Templates />;
    case 'outbox': return <Outbox />;
    case 'settings': return <Settings />;
    case 'backup': return <Backup />;
    case 'logins': return <Logins />;
    default: return <div className="py-16 text-center text-slate-500">Unknown administration page.</div>;
  }
}
