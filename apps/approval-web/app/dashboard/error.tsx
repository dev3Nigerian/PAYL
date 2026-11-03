"use client";

export default function Error({ reset }: { reset: () => void }) {
  return <main className="loading-workspace"><h1>Let’s try that again.</h1><p>We couldn’t load your workspace. Please try again in a moment.</p><button className="primary-button" type="button" onClick={reset}>Reload workspace</button><a href="/">Back to Antspace</a></main>;
}
