import { useEffect, useRef, useState } from "react";

const useMeasure = () => {
  const ref = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.target.getBoundingClientRect();

        setBounds({
          height: rect.height,
          width: rect.width,
        });
      }
    });

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return [ref, bounds] as const;
};

export default useMeasure;
