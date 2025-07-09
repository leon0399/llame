import { useMemo, useState } from "react";

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) {
    return 'morning';
  } else if (hour >= 12 && hour < 17) {
    return 'afternoon';
  } else if (hour >= 17 && hour < 21) {
    return 'evening';
  } else {
    return 'night';
  }
}

export function useTimeOfDay(): TimeOfDay {
  const [hour, setHour] = useState(new Date().getHours());

  // Update the hour every minute
  useMemo(() => {
    const interval = setInterval(() => {
      setHour(new Date().getHours());
    }, 60_000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  const timeOfDay = useMemo(() => getTimeOfDay(hour), [hour]);

  return timeOfDay;
}