import { useState } from 'react';
import { Rocket } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ReviewQueueSection } from './review-queue-section';
import { LaunchReviewDialog } from './launch-review-dialog';

/** Standalone Review Queue page (FR-7.1, delivery-plan.md P8 task 3) \u2014 every bucket in full,
 * plus the entry point into the launcher. */
export default function ReviewQueuePage(): React.JSX.Element {
  const [launchOpen, setLaunchOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Review queue</h1>
          <p className="text-sm text-muted-foreground">What's due, ordered by how overdue and how weak it is.</p>
        </div>
        <Button onClick={() => setLaunchOpen(true)}>
          <Rocket /> Start review session
        </Button>
      </div>

      <ReviewQueueSection />

      <LaunchReviewDialog open={launchOpen} onOpenChange={setLaunchOpen} />
    </div>
  );
}
