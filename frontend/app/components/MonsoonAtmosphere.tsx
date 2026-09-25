"use client";

import { useEffect, useRef } from "react";

interface RainDrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  width: number;
}

interface MistCloud {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  speedX: number;
  opacity: number;
}

export function MonsoonAtmosphere({ isButtonHovered = false }: { isButtonHovered?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef(false);

  useEffect(() => {
    hoverRef.current = isButtonHovered;
  }, [isButtonHovered]);
  const mouseRef = useRef<{ x: number; y: number; targetX: number; targetY: number }>({
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      // Normalized offset (-1 to 1) for subtle parallax
      mouseRef.current.targetX = (e.clientX / width - 0.5) * 2;
      mouseRef.current.targetY = (e.clientY / height - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove);

    // 1. Natural delicate monsoon raindrops
    const rainCount = Math.floor(Math.min(width, 1920) / 6);
    const rainDrops: RainDrop[] = [];
    for (let i = 0; i < rainCount; i++) {
      rainDrops.push({
        x: Math.random() * (width + 240) - 120,
        y: Math.random() * height,
        length: 25 + Math.random() * 35,
        speed: 12 + Math.random() * 8,
        opacity: 0.15 + Math.random() * 0.2, // More visible
        width: 1.0 + Math.random() * 0.8, // Thicker
      });
    }

    // 2. Slow-drifting low-altitude valley mist banks
    const mistClouds: MistCloud[] = [
      {
        x: width * 0.15,
        y: height * 0.28,
        radiusX: 380,
        radiusY: 180,
        speedX: 0.08,
        opacity: 0.035,
      },
      {
        x: width * 0.65,
        y: height * 0.35,
        radiusX: 480,
        radiusY: 220,
        speedX: 0.06,
        opacity: 0.04,
      },
      {
        x: width * 0.4,
        y: height * 0.55,
        radiusX: 420,
        radiusY: 200,
        speedX: 0.07,
        opacity: 0.03,
      },
      {
        x: width * 0.85,
        y: height * 0.48,
        radiusX: 360,
        radiusY: 160,
        speedX: 0.09,
        opacity: 0.032,
      },
    ];

    let time = 0;
    let rainOpacityMultiplier = 1.0;

    const render = () => {
      time += 0.005;

      const targetMultiplier = hoverRef.current ? 0.0 : 1.0;
      // Slower lerp for a gentle 2-3 second fade
      rainOpacityMultiplier += (targetMultiplier - rainOpacityMultiplier) * 0.012;

      // Smooth mouse lerp for natural parallax
      const mouse = mouseRef.current;
      mouse.x += (mouse.targetX - mouse.x) * 0.04;
      mouse.y += (mouse.targetY - mouse.y) * 0.04;

      // Transparent clearing to keep the photographic environmental scene underneath
      ctx.clearRect(0, 0, width, height);

      // --- MIST LAYER (Natural low cloud drift across the ridges) ---
      for (const cloud of mistClouds) {
        cloud.x += cloud.speedX;
        if (cloud.x - cloud.radiusX > width) {
          cloud.x = -cloud.radiusX;
        }

        // Apply slight parallax offset
        const posX = cloud.x + mouse.x * 12;
        const posY = cloud.y + mouse.y * 8;

        const mistGrad = ctx.createRadialGradient(
          posX,
          posY,
          0,
          posX,
          posY,
          cloud.radiusX
        );
        mistGrad.addColorStop(0, `rgba(50, 85, 105, ${cloud.opacity})`);
        mistGrad.addColorStop(0.5, `rgba(25, 50, 68, ${cloud.opacity * 0.5})`);
        mistGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = mistGrad;
        ctx.beginPath();
        ctx.ellipse(
          posX,
          posY,
          cloud.radiusX,
          cloud.radiusY,
          -0.08, // Slight natural angle matching mountain valley
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      // --- SUBTLE TOPOGRAPHIC ELEVATION CONTOURS (Restrained geospatial detail) ---
      // Faint, elegant contour paths across the mountain slopes
      ctx.save();
      const contourYBase = [0.26, 0.42, 0.58, 0.74];
      for (let i = 0; i < contourYBase.length; i++) {
        const baseY = height * contourYBase[i] + mouse.y * (4 + i * 2);
        ctx.beginPath();
        ctx.strokeStyle = "rgba(95, 184, 212, 0.024)"; // Very faint #5FB8D4
        ctx.lineWidth = 0.8;
        if (i % 2 === 1) {
          ctx.setLineDash([5, 16]);
        } else {
          ctx.setLineDash([]);
        }

        const step = 28;
        for (let x = 0; x <= width + step; x += step) {
          const wave =
            Math.sin(x * 0.0018 + time * 0.3 + i * 0.9) * (20 + i * 5) +
            Math.cos(x * 0.0009 - time * 0.2 + i) * 15;
          const y = baseY + wave;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
      ctx.restore();

      // --- SUBTLE GEOSPATIAL GRID TICKS (Rewarding close inspection) ---
      ctx.save();
      ctx.fillStyle = "rgba(127, 150, 163, 0.035)";
      const gridSpacing = 160;
      const startX = (width % gridSpacing) / 2;
      const startY = (height % gridSpacing) / 2;
      const tickSize = 3;

      for (let gx = startX; gx < width; gx += gridSpacing) {
        for (let gy = startY; gy < height; gy += gridSpacing) {
          // Small technical '+' registration mark
          ctx.fillRect(gx - tickSize, gy, tickSize * 2 + 1, 1);
          ctx.fillRect(gx, gy - tickSize, 1, tickSize * 2 + 1);
        }
      }
      ctx.restore();

      // --- DELICATE MONSOON RAINFALL PARTICLES ---
      ctx.save();
      const rainAngle = 0.16; // ~9 degree gentle wind slant
      const sinA = Math.sin(rainAngle);
      const cosA = Math.cos(rainAngle);

      for (const drop of rainDrops) {
        drop.x += drop.speed * sinA;
        drop.y += drop.speed * cosA;

        // Wrap around seamlessly
        if (drop.y > height + drop.length) {
          drop.y = -drop.length;
          drop.x = Math.random() * (width + 240) - 120;
        }
        if (drop.x > width + 120) {
          drop.x = -120;
        }

        ctx.strokeStyle = `rgba(185, 215, 230, ${drop.opacity * rainOpacityMultiplier})`;
        ctx.lineWidth = drop.width;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - drop.length * sinA, drop.y - drop.length * cosA);
        ctx.stroke();
      }
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[2] h-full w-full"
      aria-hidden="true"
    />
  );
}
