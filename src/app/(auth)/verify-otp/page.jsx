import { VerifyOtpView } from '@/views/auth';
export default async function Page({ searchParams }) { const sp = await searchParams; return <VerifyOtpView identifier={sp?.id || ''} />; }
