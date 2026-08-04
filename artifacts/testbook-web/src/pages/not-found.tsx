import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="exam-grid flex min-h-[100dvh] items-center justify-center bg-[#eef3f5] p-5">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_20px_60px_rgba(24,36,54,.1)] sm:p-12">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f8f5] text-[#159c8d]"><Compass size={27} /></div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-[#159c8d]">testbook+ / focus mode</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#182436]" data-testid="text-not-found-title">This page is off the paper</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500" data-testid="text-not-found-detail">The route you requested does not exist. Return to the exam hall and keep your momentum.</p>
        <Link href="/" data-testid="link-not-found-home" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-[#182436] px-5 py-3 text-sm font-bold text-white hover:bg-[#25354a]"><ArrowLeft size={16} /> Back to test</Link>
      </section>
    </main>
  );
}