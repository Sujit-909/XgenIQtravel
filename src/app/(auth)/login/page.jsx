import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { LoginView } from '@/views/auth';

export const dynamic = 'force-dynamic';
export default async function Page() {
  if (await currentUser()) redirect('/dashboard');
  return <LoginView />;
}
