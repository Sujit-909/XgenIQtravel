import '@/lib/api/routes';
import { dispatch } from '@/lib/api/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Reuse session authentication, CSRF checks and bounded parsing in the API dispatcher.
export const POST = dispatch;
