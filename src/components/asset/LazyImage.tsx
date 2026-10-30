import {
  FC,
  useEffect,
  useState,
  useRef,
  ImgHTMLAttributes,
} from 'react';
import { IconsModule } from '@decky/ui';

interface LazyImage extends ImgHTMLAttributes<HTMLImageElement | HTMLVideoElement> {
  isVideo?: boolean,
  unloadWhenOutside?: boolean,
  marginOffset?: IntersectionObserverInit['rootMargin'];
  scrollContainer?: IntersectionObserverInit['root'];
  src: string,
  wrapperProps?: any,
  blurBackground?: boolean,
}

export const LazyImage: FC<LazyImage> = ({
  isVideo = false,
  unloadWhenOutside = false,
  marginOffset,
  scrollContainer,
  src,
  wrapperProps,
  blurBackground = false,
  ...props
}) => {
  const [inViewport, setInViewport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const intersectRef = useRef<HTMLDivElement>(null);

  const elementRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  // React 18 ignores a cleanup returned from a callback ref, so the listeners
  // used to leak on every unmount: bind them in an effect instead.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const onLoad = () => {
      if (isVideo) {
        (element as HTMLVideoElement).play();
      }
      setLoading(false);
    };
    const onError = () => setError(true);

    const loadEvent = isVideo ? 'canplaythrough' : 'load';
    element.addEventListener(loadEvent, onLoad);
    element.addEventListener('error', onError);
    // A cached image can finish before the listener is attached.
    if (!isVideo && (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0) {
      onLoad();
    }
    return () => {
      element.removeEventListener(loadEvent, onLoad);
      element.removeEventListener('error', onError);
    };
  }, [isVideo, src, inViewport]);

  // reset some state when src changes
  useEffect(() => {
    setInViewport(false);
    setError(false);
    setLoading(true);
  }, [src]);

  useEffect(() => {
    if (!intersectRef.current) return;

    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio >= .5) {
          setInViewport(true);
          if (!unloadWhenOutside) {
            observer.unobserve(entry.target);
          }
        } else if (unloadWhenOutside && !loading && entry.intersectionRatio === 0) {
          /* If completely out of view and already loaded, reset state.
             images/videos should be cached by CEF so when back to view they will load instantly */
          setInViewport(false);
          setLoading(true);
        }
      });
    }, { threshold: [.5, 0], rootMargin: marginOffset, root: scrollContainer });

    observer.observe(intersectRef.current);
    return () => {
      observer.disconnect();
    };
  }, [loading, marginOffset, unloadWhenOutside, scrollContainer, src]);

  return (
    <div
      ref={intersectRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      {...wrapperProps}
    >
      {error && <IconsModule.WiredNetworkWarning style={{ height: '2em' }} />}

      {(inViewport && !isVideo && error !== true) && (
        <>
          {blurBackground && (
            <img
              className="blur-bg"
              data-loaded={loading ? 'false' : 'true'}
              src={src}
              {...props}
            />
          )}
          <img
            ref={elementRef as any}
            data-loaded={loading ? 'false' : 'true'}
            src={src}
            {...props}
          />
        </>
      )}

      {(inViewport && isVideo && error !== true) && (
        <video
          ref={elementRef as any}
          data-loaded={loading ? 'false' : 'true'}
          src={src}
          autoPlay={false}
          muted
          loop
          playsInline
          {...props}
        />
      )}
    </div>
  );
};

export default LazyImage;
