import { LandingFooter, Ticker } from '@/components/landing/Chrome';
import { SiteNav } from '@/components/SiteNav';
import { ScrollProgress } from '@/components/landing/Motion';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing-bg">
      <ScrollProgress />
      <SiteNav />
      <Ticker />
      <div className="mx-auto max-w-[1384px] border-x border-ink/10 bg-opal/60">
        {children}
        <LandingFooter />
      </div>
    </div>
  );
}
