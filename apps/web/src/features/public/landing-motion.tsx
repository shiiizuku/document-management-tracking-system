'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
}

/**
 * Progressive motion for the public landing page. Content remains server rendered and complete
 * without JavaScript; this island only adds choreography when the visitor has not requested
 * reduced motion.
 */
export function LandingMotion() {
  useGSAP(() => {
    const media = gsap.matchMedia();

    media.add('(prefers-reduced-motion: no-preference)', () => {
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .from('[data-landing-nav]', { y: -24, opacity: 0, duration: 0.7 })
        .from('[data-hero-copy] > *', { y: 32, opacity: 0, duration: 0.8, stagger: 0.1 }, '-=0.35')
        .from(
          '[data-landing-sign-in]',
          { x: 48, y: 18, scale: 0.96, opacity: 0, duration: 0.9 },
          '-=0.7',
        );

      gsap.to('[data-landing-orbit]', {
        xPercent: 22,
        yPercent: -8,
        scale: 1.12,
        ease: 'none',
        scrollTrigger: {
          trigger: '[data-hero-copy]',
          start: 'top top+=120',
          end: 'bottom top',
          scrub: 1.2,
        },
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((element) => {
        gsap.from(element.children, {
          y: 54,
          opacity: 0,
          scale: 0.96,
          duration: 0.9,
          stagger: 0.09,
          ease: 'power3.out',
          scrollTrigger: { trigger: element, start: 'top 82%' },
        });
      });

      // Grid tracks stay in their computed positions while the cards enter. Translating direct
      // grid children can visually cross the next row during a stagger, even though layout itself
      // is correct.
      gsap.from('[data-reveal-grid] > *', {
        opacity: 0,
        scale: 0.97,
        duration: 0.75,
        stagger: 0.07,
        ease: 'power3.out',
        scrollTrigger: { trigger: '[data-reveal-grid]', start: 'top 82%' },
      });

      gsap.fromTo(
        '[data-story-word]',
        { opacity: 0.12 },
        {
          opacity: 1,
          stagger: 0.045,
          ease: 'none',
          scrollTrigger: {
            trigger: '[data-story-word]',
            start: 'top 82%',
            end: 'bottom 45%',
            scrub: 1,
          },
        },
      );

      gsap.fromTo(
        '[data-ledger-seal]',
        { scale: 0.8, opacity: 0.25, rotate: -8 },
        {
          scale: 1,
          opacity: 0.72,
          rotate: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: '[data-ledger-seal]',
            start: 'top bottom',
            end: 'center center',
            scrub: 1,
          },
        },
      );
    });

    return () => media.revert();
  }, []);

  return null;
}
