import { useRef, useState, useEffect, type CSSProperties } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);

interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string;
  splitType?: 'chars' | 'words' | 'lines';
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  tag?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  textAlign?: CSSProperties['textAlign'];
  animate?: boolean;
}

export default function SplitText({ text, className = '', delay = 50, duration = 1.1, ease = 'power3.out', splitType = 'words', from = { opacity: 0, y: 40 }, to = { opacity: 1, y: 0 }, tag = 'p', textAlign = 'left', animate = true }: SplitTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [fontsLoaded, setFontsLoaded] = useState(document.fonts.status === 'loaded');

  useEffect(() => {
    if (!fontsLoaded) void document.fonts.ready.then(() => setFontsLoaded(true));
  }, [fontsLoaded]);

  useGSAP(() => {
    const element = ref.current;
    if (!element || !fontsLoaded || !animate) return;
    const split = new GSAPSplitText(element, { type: splitType, smartWrap: true, autoSplit: splitType === 'lines', linesClass: 'split-line', wordsClass: 'split-word', charsClass: 'split-char', reduceWhiteSpace: false });
    const targets = splitType === 'chars' ? split.chars : splitType === 'lines' ? split.lines : split.words;
    gsap.fromTo(targets, { ...from }, { ...to, duration, ease, stagger: delay / 1000, willChange: 'transform, opacity', force3D: true, clearProps: 'willChange' });
    return () => split.revert();
  }, { dependencies: [text, delay, duration, ease, splitType, animate, fontsLoaded], scope: ref });

  const Tag = tag;
  return <Tag ref={ref as never} style={{ textAlign }} className={className}>{text}</Tag>;
}
