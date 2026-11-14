import { t, useLanguage } from './i18n';
import { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import './capture-illustration.css';

gsap.registerPlugin(useGSAP);
type Phase = 'ready' | 'aiming' | 'flash' | 'captured';

export default function CaptureIllustration() {
  useLanguage();
  const root = useRef<HTMLElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLDivElement>(null);
  const shootRef = useRef<(() => void) | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const pointerInside = useRef(false);
  const lastPointerType = useRef('mouse');
  const [loaded, setLoaded] = useState({ hand: false, camera: false });
  const [assetError, setAssetError] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const ready = loaded.hand && loaded.camera && !assetError;

  useGSAP(() => {
    if (!ready) return;
    const media = gsap.matchMedia();
    media.add({ reduced: '(prefers-reduced-motion: reduce)', motion: '(prefers-reduced-motion: no-preference)' }, context => {
      if (context.conditions?.reduced) {
      setReduced(true);
      setPhase('ready');
      gsap.set([flash.current, light.current], { opacity: 0 });
      gsap.set(camera.current, { clearProps: 'transform' });
      shootRef.current = () => setPhase('captured');
      resetRef.current = () => setPhase('ready');
      return () => { shootRef.current = null; resetRef.current = null; };
      }
      setReduced(false);
      setPhase('ready');
      const timeline = gsap.timeline({
        paused: true, defaults: { ease: 'power2.out' },
        onStart: () => setPhase('aiming'),
        onComplete: () => setPhase('captured'),
      });
      timeline
        .set([flash.current, light.current], { opacity: 0 })
        .fromTo(camera.current, { x: 24, y: -16, rotation: 5, scale: .94 },
          { x: 0, y: 0, rotation: -10, scale: 1, duration: .8 }, 0)
        .addLabel('shutter', 1.05)
        .call(() => setPhase('flash'), [], 'shutter')
        .to(flash.current, { opacity: .98, duration: .12, ease: 'power1.out' }, 'shutter')
        .to(flash.current, { opacity: 0, duration: .88, ease: 'power1.in' }, 'shutter+=0.12')
        .to(light.current, { opacity: .55, duration: .12 }, 'shutter')
        .to(light.current, { opacity: 0, duration: .88, ease: 'power1.in' }, 'shutter+=0.12')
        .to(camera.current, { y: -5, duration: .1 }, 'shutter')
        .to(camera.current, { y: 0, duration: .18 }, 'shutter+=0.1');

      const shoot = () => {
        if (!document.hidden && !timeline.isActive()) timeline.restart();
      };
      const reset = () => { timeline.pause(0, true); setPhase('ready'); };
      shootRef.current = shoot;
      resetRef.current = reset;
      const onVisibilityChange = () => { if (document.hidden) reset(); };
      document.addEventListener('visibilitychange', onVisibilityChange);
      // If the pointer arrived before the images loaded, honor that intent.
      if (pointerInside.current) shoot();
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        timeline.kill();
        shootRef.current = null;
        resetRef.current = null;
      };
    });
    return () => media.revert();
  }, { scope: root, dependencies: [ready], revertOnUpdate: true });

  return (
    <figure ref={root} className="capture-illustration" data-ready={ready} data-phase={phase} data-reduced={reduced}>
      <button type="button" className="capture-stage" aria-label={t("ชี้ แตะ หรือกด Enter เพื่อจำลองกล้องถ่ายภาพมือคว่ำ")}
        aria-describedby="capture-description" aria-disabled={!ready} aria-busy={!ready && !assetError}
        onPointerEnter={event => {
          if (event.pointerType === 'mouse') { pointerInside.current = true; shootRef.current?.(); }
        }}
        onPointerLeave={event => {
          if (event.pointerType === 'mouse') { pointerInside.current = false; resetRef.current?.(); }
        }}
        onPointerDown={event => { lastPointerType.current = event.pointerType; }}
        onClick={event => {
          if (event.detail === 0 || lastPointerType.current !== 'mouse') shootRef.current?.();
        }}>
        <span className="capture-backdrop" aria-hidden="true" />
        {!assetError ? <>
          <img className="capture-hand" src="/illustrations/bruise-hand-clay.webp" alt="" width="1774" height="887"
            decoding="async" onLoad={() => setLoaded(value => ({ ...value, hand: true }))} onError={() => setAssetError(true)} />
          <span ref={camera} className="capture-camera" aria-hidden="true">
            <img src="/illustrations/camera-clay.webp" alt="" width="1361" height="1156" decoding="async"
              onLoad={() => setLoaded(value => ({ ...value, camera: true }))} onError={() => setAssetError(true)} />
            <span ref={flash} className="capture-burst" />
          </span>
          <span ref={light} className="capture-light" aria-hidden="true" />
        </> : <span className="capture-unavailable">{t("โหลดภาพประกอบไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ")}</span>}
      </button>
      <figcaption id="capture-description" className="sr-only">{t("ภาพ clay จำลองมือคว่ำที่มีรอยฟกช้ำและกล้องถ่ายภาพบนพื้นหลังเบลอ ไม่ใช่ผลวิเคราะห์จริง")}<span role="status">{phase === 'captured' ? t("ถ่ายภาพจำลองแล้ว") : phase === 'flash' ? t("กำลังถ่ายภาพจำลอง") : t("พร้อมจำลองการถ่ายภาพ")}</span>
      </figcaption>
    </figure>
  );
}
