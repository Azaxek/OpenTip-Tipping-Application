import { SubmitPage } from '@/components/pages/SubmitPage';

export const metadata = { title: 'Submit a tip' };

export default async function Submit({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  return <SubmitPage lang="en" caseId={(await searchParams).case} />;
}
