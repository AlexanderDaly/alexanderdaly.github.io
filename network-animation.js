class NetworkAnimation {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: 0, y: 0 };
        this.animationId = null;
        
        this.init();
        this.setupEventListeners();
        this.animate();
    }
    
    init() {
        this.resizeCanvas();
        this.createParticles();
    }
    
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }
    
    createParticles() {
        const numParticles = Math.floor((this.canvas.width * this.canvas.height) / 15000);
        this.particles = [];
        
        for (let i = 0; i < numParticles; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 2 + 1,
                opacity: Math.random() * 0.5 + 0.2
            });
        }
    }
    
    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.createParticles();
        });
        
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        });
        
        window.addEventListener('mouseleave', () => {
            this.mouse.x = -1000;
            this.mouse.y = -1000;
        });
    }
    
    drawParticle(particle) {
        this.ctx.beginPath();
        this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(0, 212, 255, ${particle.opacity})`;
        this.ctx.fill();
    }
    
    drawConnections() {
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            
            // Connect to mouse
            const mouseDistance = Math.sqrt(
                Math.pow(this.mouse.x - particle.x, 2) + 
                Math.pow(this.mouse.y - particle.y, 2)
            );
            
            if (mouseDistance < 150) {
                this.ctx.beginPath();
                this.ctx.moveTo(particle.x, particle.y);
                this.ctx.lineTo(this.mouse.x, this.mouse.y);
                const opacity = (150 - mouseDistance) / 150 * 0.8;
                this.ctx.strokeStyle = `rgba(0, 212, 255, ${opacity})`;
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
            }
            
            // Connect to nearby particles
            for (let j = i + 1; j < this.particles.length; j++) {
                const otherParticle = this.particles[j];
                const distance = Math.sqrt(
                    Math.pow(particle.x - otherParticle.x, 2) + 
                    Math.pow(particle.y - otherParticle.y, 2)
                );
                
                if (distance < 100) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(particle.x, particle.y);
                    this.ctx.lineTo(otherParticle.x, otherParticle.y);
                    const opacity = (100 - distance) / 100 * 0.3;
                    this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.stroke();
                }
            }
        }
    }
    
    updateParticles() {
        for (let particle of this.particles) {
            // Mouse attraction
            const mouseDistance = Math.sqrt(
                Math.pow(this.mouse.x - particle.x, 2) + 
                Math.pow(this.mouse.y - particle.y, 2)
            );
            
            if (mouseDistance < 200) {
                const force = (200 - mouseDistance) / 200 * 0.01;
                const angle = Math.atan2(this.mouse.y - particle.y, this.mouse.x - particle.x);
                particle.vx += Math.cos(angle) * force;
                particle.vy += Math.sin(angle) * force;
            }
            
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;
            
            // Apply friction
            particle.vx *= 0.99;
            particle.vy *= 0.99;
            
            // Boundary checks
            if (particle.x < 0 || particle.x > this.canvas.width) {
                particle.vx *= -0.5;
                particle.x = Math.max(0, Math.min(this.canvas.width, particle.x));
            }
            if (particle.y < 0 || particle.y > this.canvas.height) {
                particle.vy *= -0.5;
                particle.y = Math.max(0, Math.min(this.canvas.height, particle.y));
            }
        }
    }
    
    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.updateParticles();
        this.drawConnections();
        
        for (let particle of this.particles) {
            this.drawParticle(particle);
        }
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
    }
}
