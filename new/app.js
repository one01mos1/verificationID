// Identity Verification System - Main Application
class IdentityVerificationSystem {
    constructor() {
        this.currentPhase = 1;
        this.extractedData = {};
        this.capturedImages = {
            idBack: null,
            idFront: null,
            portrait: null,
            selfie: null
        };
        this.capturedPoses = [];
        this.documentType = null;
        this.streams = {};
        this.isInitialized = false;
        this._selfieInProgress = false;
    }

    async init() {
        try {
            console.log('Initializing Identity Verification System...');

            this.updateInitStatus('Loading image processing...', 10);

            // Mark OpenCV as done if already ready
            if (window.__opencvReady) {
                this.markInitStep('initCheckOpencv');
            }

            // Mark Tesseract as done if loaded
            if (window.Tesseract) {
                this.markInitStep('initCheckTesseract');
                this.updateInitStatus('Tesseract ready...', 30);
            }

            // Load face detection models (gated on faceapi availability)
            if (window.faceapi) {
                this.updateInitStatus('Downloading face detection models...', 40);
                await this.loadFaceModels();
                this.markInitStep('initCheckFaceapi');
            } else {
                console.warn('face-api.js not loaded yet, face models will load on demand');
            }

            // Setup event listeners
            this.setupEventListeners();

            // Start first camera
            this.updateInitStatus('Starting camera...', 80);
            await this.startCamera('video');
            this.markInitStep('initCheckCamera');

            // Mark as initialized
            this.isInitialized = true;
            console.log('System fully initialized');

            // Dismiss the overlay
            this.updateInitStatus('Ready!', 100);
            this.dismissInitOverlay();

            // Setup cleanup handlers
            this.setupCleanupHandlers();
        } catch (error) {
            console.error('Initialization error:', error);
            this.showGlobalError('System failed to initialize. Please refresh the page.');
            this.dismissInitOverlay();
        }
    }

    // ==================== Init Overlay Helpers ====================

    updateInitStatus(message, progressPercent) {
        const status = document.getElementById('initStatus');
        const fill = document.getElementById('initProgressFill');
        if (status) status.textContent = message;
        if (fill) fill.style.width = progressPercent + '%';
    }

    markInitStep(stepId) {
        const el = document.getElementById(stepId);
        if (!el) return;
        el.classList.add('done');
        // Swap spinning icon for a checkmark
        const icon = el.querySelector('i');
        if (icon) {
            icon.className = 'fa-solid fa-circle-check';
        }
    }

    dismissInitOverlay() {
        const overlay = document.getElementById('initOverlay');
        if (overlay) {
            // Short delay so user sees "Ready!" state
            setTimeout(() => {
                overlay.classList.add('fade-out');
                // Remove from DOM after transition
                setTimeout(() => overlay.remove(), 500);
            }, 400);
        }
    }

    // ==================== Global Error Boundary ====================

    showGlobalError(message) {
        const content = document.querySelector('.content');
        if (content) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.innerHTML = `
                <strong><i class="fa-solid fa-circle-xmark"></i> Initialization Error</strong>
                <p>${message}</p>
                <div class="controls">
                    <button class="btn-primary" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i> Refresh Page</button>
                </div>
            `;
            content.prepend(errorDiv);
        }
    }

    // ==================== Unified Feedback Helpers ====================

    showPhaseError(resultElementId, title, message, retryAction) {
        const el = document.getElementById(resultElementId);
        if (!el) return;
        el.innerHTML = `
            <div class="error-message">
                <strong><i class="fa-solid fa-circle-xmark"></i> ${title}</strong>
                <p>${message}</p>
            </div>
            <div class="controls">
                <button class="btn-primary" data-action="${retryAction}"><i class="fa-solid fa-rotate-right"></i> Try Again</button>
            </div>
        `;
        el.classList.remove('hidden');
    }

    showPhaseSuccess(resultElementId, title, detailsHtml, nextAction, nextLabel) {
        const el = document.getElementById(resultElementId);
        if (!el) return;
        el.innerHTML = `
            <div class="success-message">
                <strong><i class="fa-solid fa-circle-check"></i> ${title}</strong>
                ${detailsHtml}
            </div>
            ${nextAction ? `
            <div class="controls">
                <button class="btn-success" data-action="goToPhase" data-param="${nextAction}">${nextLabel || 'Continue'} <i class="fa-solid fa-arrow-right"></i></button>
            </div>
            ` : ''}
        `;
        el.classList.remove('hidden');
    }

    // ==================== Cleanup & Lifecycle ====================

    setupCleanupHandlers() {
        window.addEventListener('beforeunload', () => this.cleanup());

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseCameras();
            } else {
                this.resumeCameras();
            }
        });

        window.addEventListener('pagehide', () => this.cleanup());
    }

    cleanup() {
        console.log('Cleaning up resources...');

        // Stop all camera streams
        Object.keys(this.streams).forEach(videoId => {
            this.stopCamera(videoId);
        });

        // Clear captured image data
        if (this.capturedImages) {
            this.capturedImages.idBack = null;
            this.capturedImages.idFront = null;
            this.capturedImages.portrait = null;
            this.capturedImages.selfie = null;
        }

        // Clear biometric data
        this.clearBiometricData();

        // Clear captured poses
        if (this.capturedPoses) {
            this.capturedPoses = [];
        }

        console.log('Cleanup complete');
    }

    clearBiometricData() {
        if (this.extractedData) {
            this.extractedData.portraitDescriptor = null;
            this.extractedData.biometrics = null;
        }
        if (this.capturedPoses) {
            this.capturedPoses.forEach(p => {
                if (p) p.canvas = null;
            });
            this.capturedPoses = [];
        }
    }

    pauseCameras() {
        console.log('Pausing cameras...');
        Object.values(this.streams).forEach(stream => {
            stream.getTracks().forEach(track => {
                track.enabled = false;
            });
        });
    }

    resumeCameras() {
        console.log('Resuming cameras...');
        Object.values(this.streams).forEach(stream => {
            stream.getTracks().forEach(track => {
                track.enabled = true;
            });
        });
    }

    // ==================== Comprehensive Error Handling ====================

    handleError(error, context = '') {
        console.error(`Error in ${context}:`, error);

        let userMessage = '';
        let technicalDetails = error.message || 'Unknown error';
        let recoveryActions = [];

        if (error.name === 'NotAllowedError' || error.message.includes('permission')) {
            userMessage = 'Camera permission denied';
            recoveryActions = [
                'Allow camera access in your browser settings',
                'Refresh the page and try again'
            ];
        } else if (error.name === 'NotFoundError' || error.message.includes('camera')) {
            userMessage = 'No camera found';
            recoveryActions = [
                'Connect a camera to your device',
                'Check if another application is using the camera'
            ];
        } else if (error.message.includes('OpenCV') || error.message.includes('cv')) {
            userMessage = 'Image processing error';
            recoveryActions = [
                'Ensure good lighting conditions',
                'Try capturing the image again'
            ];
        } else if (error.message.includes('face') || error.message.includes('Face')) {
            userMessage = 'Face detection failed';
            recoveryActions = [
                'Ensure your face is well-lit and clearly visible',
                'Remove glasses or face coverings if possible',
                'Position your face within the frame'
            ];
        } else if (error.message.includes('MRZ') || error.message.includes('OCR')) {
            userMessage = 'Document reading failed';
            recoveryActions = [
                'Ensure the document is well-lit',
                'Hold the document steady',
                'Clean the camera lens',
                'Make sure the MRZ lines are clearly visible'
            ];
        } else if (error.message.includes('timeout')) {
            userMessage = 'Operation timed out';
            recoveryActions = [
                'Check your internet connection',
                'Try again with better lighting',
                'Refresh the page if the problem persists'
            ];
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            userMessage = 'Network error';
            recoveryActions = [
                'Check your internet connection',
                'Try again in a few moments'
            ];
        } else {
            userMessage = 'An unexpected error occurred';
            recoveryActions = [
                'Try the operation again',
                'Refresh the page if the problem persists'
            ];
        }

        return { userMessage, technicalDetails, recoveryActions, context };
    }

    displayError(error, context, targetElementId) {
        const errorInfo = this.handleError(error, context);

        const recoveryHtml = errorInfo.recoveryActions.map(action =>
            `<li>${action}</li>`
        ).join('');

        const errorHtml = `
            <div class="error-card">
                <div class="error-card-header">
                    <div class="error-icon">
                        <i class="fa-solid fa-circle-xmark"></i>
                    </div>
                    <div class="error-title">${errorInfo.userMessage}</div>
                </div>
                <div class="error-message">
                    ${errorInfo.technicalDetails}
                </div>
                ${errorInfo.recoveryActions.length > 0 ? `
                    <div class="error-tips">
                        <h4><i class="fa-solid fa-lightbulb"></i> Troubleshooting Tips:</h4>
                        <ul>${recoveryHtml}</ul>
                    </div>
                ` : ''}
                <div class="error-actions">
                    <button class="btn-primary" data-action="${this.getRetryAction(context)}">
                        <i class="fa-solid fa-rotate-right"></i> Try Again
                    </button>
                    ${this.currentPhase > 1 ? `
                        <button class="btn-secondary" data-action="goToPhase" data-param="${this.currentPhase - 1}">
                            <i class="fa-solid fa-arrow-left"></i> Go Back
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        const targetElement = document.getElementById(targetElementId);
        if (targetElement) {
            targetElement.innerHTML = errorHtml;
            targetElement.classList.remove('hidden');
        }
    }

    getRetryAction(context) {
        const retryMap = {
            'MRZ Processing': 'captureIDBack',
            'Portrait Extraction': 'captureIDFront',
            'Selfie Capture': 'captureSelfie',
            'Face Comparison': 'captureSelfie'
        };
        return retryMap[context] || 'captureIDBack';
    }

    async loadFaceModels() {
        try {
            console.log('Loading face detection models...');
            const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';

            this.updateInitStatus('Downloading face detector...', 45);
            await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);

            this.updateInitStatus('Downloading lightweight detector...', 50);
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

            this.updateInitStatus('Downloading landmark model...', 55);
            await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

            this.updateInitStatus('Downloading recognition model...', 65);
            await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

            console.log('Face models loaded successfully');
        } catch (error) {
            console.error('Error loading face models:', error);
        }
    }

    setupEventListeners() {
        // Phase A: Back-of-ID
        document.getElementById('captureBack').addEventListener('click', () => this.captureIDBack());

        // Phase B: Front-of-ID
        document.getElementById('captureFront').addEventListener('click', () => this.captureIDFront());
        document.getElementById('backToMRZ').addEventListener('click', () => this.goToPhase(1));

        // Phase C: Selfie
        document.getElementById('captureSelfie').addEventListener('click', () => this.captureSelfie());
        document.getElementById('backToFront').addEventListener('click', () => this.goToPhase(2));

        // Phase D: Verification
        document.getElementById('submitBtn').addEventListener('click', () => this.submitRegistration());
        document.getElementById('backToSelfie').addEventListener('click', () => this.goToPhase(3));

        // Event delegation for dynamically created buttons
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            const param = target.dataset.param;

            if (!this.isInitialized) {
                console.warn('App not fully initialized yet');
                return;
            }

            if (this[action] && typeof this[action] === 'function') {
                if (param !== undefined) {
                    this[action](param);
                } else {
                    this[action]();
                }
            }
        });
    }

    // ==================== Camera Management ====================

    async startCamera(videoId) {
        try {
            const video = document.getElementById(videoId);
            if (!video) {
                console.error(`Video element '${videoId}' not found`);
                return;
            }

            // Remove camera-ready class to show loading placeholder
            const container = video.closest('.camera-container');
            if (container) {
                container.classList.remove('camera-ready');
            }

            // Stop existing stream if any
            if (this.streams[videoId]) {
                this.streams[videoId].getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    facingMode: videoId === 'video-selfie' ? 'user' : 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.streams[videoId] = stream;
            video.srcObject = stream;

            // Add camera-ready class when video starts playing
            video.addEventListener('loadeddata', () => {
                if (container) {
                    container.classList.add('camera-ready');
                }
            }, { once: true });

            console.log(`Camera started for ${videoId}`);
        } catch (error) {
            console.error('Camera access error:', error);
            this.displayError(error, 'Camera', this.getResultElementForPhase(this.currentPhase));
        }
    }

    getResultElementForPhase(phase) {
        const map = { 1: 'mrzResult', 2: 'portraitResult', 3: 'selfieResult', 4: 'finalResult' };
        return map[phase] || 'mrzResult';
    }

    stopCamera(videoId) {
        if (this.streams[videoId]) {
            this.streams[videoId].getTracks().forEach(track => track.stop());
            delete this.streams[videoId];
        }
    }

    // ==================== Phase Navigation ====================

    async goToPhase(phaseNumber) {
        phaseNumber = parseInt(phaseNumber);

        // Prerequisite validation
        if (phaseNumber >= 2 && (!this.capturedImages.idBack || !this.extractedData.id_number)) {
            console.warn('Phase 2 requires completed MRZ scan');
            return;
        }
        if (phaseNumber >= 3 && (!this.capturedImages.portrait || !this.extractedData.portraitDescriptor)) {
            console.warn('Phase 3 requires portrait extraction');
            return;
        }
        if (phaseNumber >= 4 && (!this.capturedImages.selfie || !this.extractedData.biometrics)) {
            console.warn('Phase 4 requires selfie verification');
            return;
        }

        // Stop current camera
        const currentVideoId = this.getVideoIdForPhase(this.currentPhase);
        this.stopCamera(currentVideoId);

        // Hide all phases
        document.querySelectorAll('.phase').forEach(phase => {
            phase.classList.remove('active');
        });

        // Update step indicator
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
            const stepNum = parseInt(step.dataset.step);
            if (stepNum < phaseNumber) {
                step.classList.add('completed');
            }
        });

        // Update progress line
        const stepIndicator = document.querySelector('.step-indicator');
        if (stepIndicator) {
            stepIndicator.setAttribute('data-progress', phaseNumber);
        }

        // Show target phase
        const phases = ['phase-back', 'phase-front', 'phase-selfie', 'phase-verification'];
        document.getElementById(phases[phaseNumber - 1]).classList.add('active');
        document.querySelector(`.step[data-step="${phaseNumber}"]`).classList.add('active');

        this.currentPhase = phaseNumber;

        // Restore camera view and start camera for target phase
        const newVideoId = this.getVideoIdForPhase(phaseNumber);
        if (newVideoId) {
            const newVideo = document.getElementById(newVideoId);
            if (newVideo) {
                const container = newVideo.closest('.camera-container');
                // Restore container visibility (may have been hidden on success)
                if (container) container.style.display = '';
                this.hideCapturePreview(container);
            }
            // Restore capture button row visibility
            const phaseEl = document.getElementById(['phase-back', 'phase-front', 'phase-selfie', 'phase-verification'][phaseNumber - 1]);
            if (phaseEl) {
                phaseEl.querySelectorAll('.controls').forEach(c => c.style.display = '');
            }

            // Clear result area for a fresh retry experience
            const resultId = this.getResultElementForPhase(phaseNumber);
            const resultEl = document.getElementById(resultId);
            if (resultEl) {
                resultEl.innerHTML = '';
                resultEl.classList.add('hidden');
            }

            // Reset selfie guard if going back to selfie phase
            if (phaseNumber === 3) {
                this._selfieInProgress = false;
            }

            await this.startCamera(newVideoId);
        }
    }

    getVideoIdForPhase(phase) {
        const videoIds = ['video', 'video-front', 'video-selfie', null];
        return videoIds[phase - 1];
    }

    // Helper: Wait for video stream to be ready
    async waitForVideoReady(video, timeout = 5000) {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkReady = () => {
                if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Video stream timeout'));
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    }

    // Trigger capture flash effect
    triggerFlash(container) {
        if (!container) return;
        const flash = container.querySelector('.camera-flash');
        if (flash) {
            flash.classList.remove('flash');
            // Force reflow
            void flash.offsetWidth;
            flash.classList.add('flash');
        }
    }

    // ==================== Phase A: Back-of-ID (MRZ) ====================

    async captureIDBack() {
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        try {
            await this.waitForVideoReady(video);
        } catch (error) {
            this.showPhaseError('mrzResult', 'Camera Not Ready', 'Please wait a moment and try again.', 'captureIDBack');
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        const container = video.closest('.camera-container');

        // Trigger flash
        this.triggerFlash(container);

        // Immediately freeze: stop video, show captured frame with scan animation
        this.showCapturePreview(container, canvas);

        this.capturedImages.idBack = canvas.toDataURL('image/jpeg', 0.85);

        // Show processing status below the frozen image
        const mrzResult = document.getElementById('mrzResult');
        mrzResult.innerHTML = `
            <div class="processing-status-bar">
                <div class="processing-progress">
                    <div class="processing-progress-fill" id="mrzProgressFill"></div>
                </div>
                <p class="processing-status" id="mrzProgressStatus">Reading document...</p>
            </div>
        `;
        mrzResult.classList.remove('hidden');

        // Process MRZ
        await this.processMRZ(canvas);
    }

    // Show frozen captured frame with scanning animation
    showCapturePreview(container, canvas) {
        if (!container) return;

        // Hide live video
        const video = container.querySelector('video');
        if (video) video.style.display = 'none';

        // Hide the alignment overlay
        const overlay = container.querySelector('.camera-overlay');
        if (overlay) overlay.style.display = 'none';

        // Create and show the frozen capture preview
        let preview = container.querySelector('.capture-preview');
        if (!preview) {
            preview = document.createElement('div');
            preview.className = 'capture-preview';
            container.appendChild(preview);
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        preview.innerHTML = `
            <img src="${imgData}" alt="Captured frame">
            <div class="scan-line"></div>
            <div class="capture-badge"><i class="fa-solid fa-camera"></i> Captured - Scanning...</div>
        `;
        preview.style.display = 'block';
    }

    // Restore live camera view (called when retrying or going back)
    hideCapturePreview(container) {
        if (!container) return;

        const preview = container.querySelector('.capture-preview');
        if (preview) preview.style.display = 'none';

        const video = container.querySelector('video');
        if (video) video.style.display = '';

        const overlay = container.querySelector('.camera-overlay');
        if (overlay) overlay.style.display = '';
    }

    // ==================== MRZ Processing Pipeline ====================

    async processMRZ(canvas) {
        const container = document.getElementById('video')?.closest('.camera-container');
        try {
            // Strategy 1: Full image, direct OCR (works if card fills frame)
            this.updateCaptureBadge(container, 'Reading MRZ...');
            const fullText = await this.extractMRZText(canvas);
            const cleanFull = fullText ? this.cleanMRZText(fullText) : '';
            // Use flat length (without newlines) for threshold comparisons
            const flatFull = cleanFull.replace(/\n/g, '');

            if (flatFull.length >= 60) {
                console.log('Full-image OCR succeeded, length:', cleanFull.length);
                this.updateCaptureBadge(container, 'Done!');
                return this.parseAndDisplayMRZ(fullText);
            }

            // Strategy 2: Crop bottom 40% (MRZ zone) and retry
            console.log('Full image insufficient, trying MRZ region crop...');
            this.updateCaptureBadge(container, 'Focusing on MRZ zone...');
            const mrzCanvas = this.extractMRZRegion(canvas, 0.65);
            const croppedText = await this.extractMRZText(mrzCanvas);
            const cleanCropped = croppedText ? this.cleanMRZText(croppedText) : '';
            const flatCropped = cleanCropped.replace(/\n/g, '');

            if (flatCropped.length >= 60) {
                console.log('Cropped OCR succeeded, length:', cleanCropped.length);
                this.updateCaptureBadge(container, 'Done!');
                return this.parseAndDisplayMRZ(croppedText);
            }

            // Strategy 3: Preprocess + crop (heavy lifting as last resort)
            console.log('Cropped OCR insufficient, trying with preprocessing...');
            this.updateCaptureBadge(container, 'Enhancing image...');
            const processedCanvas = await this.preprocessForMRZ(mrzCanvas);
            const processedText = await this.extractMRZText(processedCanvas);
            const cleanProcessed = processedText ? this.cleanMRZText(processedText) : '';
            const flatProcessed = cleanProcessed.replace(/\n/g, '');

            if (flatProcessed.length >= 60) {
                this.updateCaptureBadge(container, 'Done!');
                return this.parseAndDisplayMRZ(processedText);
            }

            // Use whichever got the most text
            const best = [
                { text: fullText, clean: cleanFull, flat: flatFull },
                { text: croppedText, clean: cleanCropped, flat: flatCropped },
                { text: processedText, clean: cleanProcessed, flat: flatProcessed }
            ].sort((a, b) => b.flat.length - a.flat.length)[0];

            if (best.flat.length >= 30) {
                this.updateCaptureBadge(container, 'Done!');
                return this.parseAndDisplayMRZ(best.text);
            }

            throw new Error('Could not read MRZ. Please ensure good lighting and the MRZ lines are clearly visible.');
        } catch (error) {
            console.error('MRZ processing error:', error);
            this.hideCapturePreview(container);
            // Restore camera container visibility for retry
            if (container) container.style.display = '';
            const captureBtn = document.getElementById('captureBack')?.closest('.controls');
            if (captureBtn) captureBtn.style.display = '';
            this.showPhaseError('mrzResult', 'MRZ Extraction Failed', error.message + '<p class="tip">Tips: Ensure good lighting, hold ID steady, MRZ should be clearly visible</p>', 'captureIDBack');
        }
    }

    updateCaptureBadge(container, text) {
        if (!container) return;
        const badge = container.querySelector('.capture-badge');
        if (badge) badge.textContent = text;
    }

    // Extract bottom portion of image as MRZ region
    extractMRZRegion(canvas, cropStart = 0.60) {
        const mrzCanvas = document.createElement('canvas');
        const ctx = mrzCanvas.getContext('2d');
        const cropY = Math.floor(canvas.height * cropStart);
        const cropHeight = canvas.height - cropY;

        mrzCanvas.width = canvas.width;
        mrzCanvas.height = cropHeight;

        ctx.drawImage(canvas, 0, cropY, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);
        return mrzCanvas;
    }

    async parseAndDisplayMRZ(rawText) {
        console.log('Raw OCR Text:', rawText);

        // Clean the text - preserving line breaks
        const cleanText = this.cleanMRZText(rawText);
        console.log('Cleaned Text:', cleanText);

        // Try different parsing strategies
        let parsedData = null;

        // First: try using natural line breaks from OCR (most reliable)
        const naturalLines = cleanText.split('\n').filter(l => l.length >= 20);
        console.log('Natural MRZ lines:', naturalLines.length, naturalLines.map(l => l.length));

        if (naturalLines.length >= 3 && naturalLines[0].length >= 25) {
            // TD1: 3 lines of ~30 chars
            parsedData = this.parseTD1(naturalLines.slice(0, 3));
            if (parsedData) this.documentType = 'TD1 (Omang/ID Card)';
        }

        if (!parsedData && naturalLines.length >= 2 && naturalLines[0].length >= 40) {
            // TD3: 2 lines of ~44 chars
            parsedData = this.parseTD3(naturalLines.slice(0, 2));
            if (parsedData) this.documentType = 'TD3 (Passport)';
        }

        if (!parsedData && naturalLines.length >= 2 && naturalLines[0].length >= 30) {
            // TD2: 2 lines of ~36 chars
            parsedData = this.parseTD2(naturalLines.slice(0, 2));
            if (parsedData) this.documentType = 'TD2 (ID Card)';
        }

        // Fallback: character-count splitting (for single-block text without line breaks)
        const flatText = cleanText.replace(/\n/g, '');

        if (!parsedData && flatText.length >= 80) {
            const lines = this.splitIntoMRZLines(flatText, 30, 3);
            parsedData = this.parseTD1(lines);
            if (parsedData) this.documentType = 'TD1 (Omang/ID Card)';
        }

        if (!parsedData && flatText.length >= 80) {
            const lines = this.splitIntoMRZLines(flatText, 44, 2);
            parsedData = this.parseTD3(lines);
            if (parsedData) this.documentType = 'TD3 (Passport)';
        }

        if (!parsedData && flatText.length >= 70) {
            const lines = this.splitIntoMRZLines(flatText, 36, 2);
            parsedData = this.parseTD2(lines);
            if (parsedData) this.documentType = 'TD2 (ID Card)';
        }

        if (!parsedData) {
            throw new Error('Could not parse MRZ data. Please ensure the MRZ is clearly visible.');
        }

        // Validate checksums
        const checksumValidation = this.validateMRZChecksums(
            parsedData,
            parsedData.raw_lines || [],
            this.documentType.split(' ')[0]
        );

        // Calculate quality score
        const quality = this.calculateMRZQuality(
            parsedData,
            parsedData.raw_lines || [],
            this.documentType,
            checksumValidation
        );

        this.extractedData = { ...this.extractedData, ...parsedData, mrzQuality: quality };

        // --- Done processing: hide the camera/scan UI, show results only ---
        const cameraContainer = document.getElementById('video')?.closest('.camera-container');
        if (cameraContainer) cameraContainer.style.display = 'none';
        // Also hide the capture button row
        const captureBtn = document.getElementById('captureBack')?.closest('.controls');
        if (captureBtn) captureBtn.style.display = 'none';

        const qualityClass = quality.percentage >= 80 ? 'status-success' : (quality.percentage >= 60 ? 'status-processing' : 'status-error');

        document.getElementById('mrzResult').innerHTML = `
            <div class="success-message">
                <strong><i class="fa-solid fa-circle-check"></i> MRZ Data Extracted Successfully</strong>
                <p>Document Type: ${this.documentType}</p>
                <p>Quality Score: <span class="${qualityClass}" style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;">${quality.quality} (${quality.percentage}%)</span></p>
                ${quality.issues.length > 0 ? `<p class="tip"><i class="fa-solid fa-triangle-exclamation"></i> ${quality.issues.join(', ')}</p>` : ''}
                ${checksumValidation.warnings.length > 0 ? `<p class="tip"><i class="fa-solid fa-triangle-exclamation"></i> Checksum warnings: ${checksumValidation.warnings.length}</p>` : ''}
            </div>
            <div class="result-card">
                <div class="result-item">
                    <span class="result-label">Name:</span>
                    <span class="result-value">${parsedData.first_name} ${parsedData.last_name}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">ID Number:</span>
                    <span class="result-value">${parsedData.id_number}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Date of Birth:</span>
                    <span class="result-value">${parsedData.date_of_birth}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Nationality:</span>
                    <span class="result-value">${parsedData.nationality}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Gender:</span>
                    <span class="result-value">${parsedData.gender}</span>
                </div>
            </div>
            <div class="controls">
                <button class="btn-success" data-action="goToPhase" data-param="2">Continue to Front Scan <i class="fa-solid fa-arrow-right"></i></button>
            </div>
        `;
    }

    // Split by newlines FIRST, clean each line individually, return with \n preserved
    cleanMRZText(text) {
        // Split by newlines first to preserve line structure
        const rawLines = text.split(/[\r\n]+/).filter(line => line.trim().length > 0);

        // Clean each line: uppercase, strip non-MRZ chars
        const cleanedLines = rawLines
            .map(line => line.toUpperCase().replace(/[^A-Z0-9<]/g, ''))
            .filter(line => line.length > 0);

        // MRZ lines are 30 (TD1), 36 (TD2), or 44 (TD3) chars.
        // Keep lines that look like MRZ (mostly <, uppercase, digits, length >= 10)
        const mrzLikeLines = cleanedLines.filter(line => {
            if (line.length < 10) return false;
            const hasFillers = (line.match(/</g) || []).length >= 2;
            return hasFillers || line.length >= 25;
        });

        if (mrzLikeLines.length >= 2) {
            // Sort by length descending - take the longest lines which are likely MRZ
            const sorted = [...mrzLikeLines].sort((a, b) => b.length - a.length);
            // For TD1 we need 3, for TD2/TD3 we need 2
            const needed = sorted.length >= 3 && sorted[2].length >= 25 ? 3 : 2;
            const topLines = sorted.slice(0, needed);
            // Preserve original order from the OCR output
            const ordered = mrzLikeLines.filter(l => topLines.includes(l));
            console.log('MRZ lines found via newlines:', ordered);
            // Return lines joined WITH newline to preserve structure
            return ordered.join('\n');
        }

        // Fallback: clean the whole thing as one block (no line info available)
        const block = text.toUpperCase().replace(/[^A-Z0-9<]/g, '');
        console.log('MRZ cleaned as single block, length:', block.length);
        return block;
    }

    // Context-aware field cleaning - FIXED: only high-confidence corrections
    cleanMRZField(value, fieldType) {
        if (!value) return value;

        let cleaned = value.toUpperCase().trim();

        if (fieldType === 'numeric') {
            // For numeric fields: only high-confidence OCR error fixes
            cleaned = cleaned
                .replace(/O/g, '0')
                .replace(/I/g, '1')
                .replace(/L/g, '1')
                .replace(/[^0-9]/g, '');
        } else if (fieldType === 'alpha') {
            // For alpha fields: only high-confidence reverse corrections
            cleaned = cleaned
                .replace(/0/g, 'O')
                .replace(/1/g, 'I')
                .replace(/[^A-Z<\s]/g, '');
        }

        return cleaned;
    }

    // Split text into MRZ lines
    splitIntoMRZLines(text, lineLength, numLines) {
        const lines = [];
        for (let i = 0; i < numLines; i++) {
            const start = i * lineLength;
            const end = start + lineLength;
            if (start < text.length) {
                let line = text.substring(start, end);
                if (line.length < lineLength) {
                    line = line.padEnd(lineLength, '<');
                }
                lines.push(line);
            }
        }
        return lines;
    }

    // ==================== OpenCV Preprocessing ====================

    async preprocessForMRZ(canvas) {
        const mats = [];
        try {
            if (!window.cv || !window.__opencvReady) {
                console.warn('OpenCV not available, using original canvas');
                return canvas;
            }

            const src = cv.imread(canvas);
            mats.push(src);

            const gray = new cv.Mat();
            mats.push(gray);
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Histogram equalization for better contrast
            const claheResult = new cv.Mat();
            mats.push(claheResult);
            try {
                // OpenCV.js: try createCLAHE (newer builds) then CLAHE constructor
                let claheObj;
                if (typeof cv.createCLAHE === 'function') {
                    claheObj = cv.createCLAHE(3.0, new cv.Size(8, 8));
                } else {
                    claheObj = new cv.CLAHE(3.0, new cv.Size(8, 8));
                }
                claheObj.apply(gray, claheResult);
                claheObj.delete();
            } catch (e) {
                // Fallback to basic histogram equalization
                console.warn('CLAHE unavailable, using equalizeHist');
                cv.equalizeHist(gray, claheResult);
            }

            // Bilateral filter - FIXED: reduced params to preserve character edges
            const filtered = new cv.Mat();
            mats.push(filtered);
            cv.bilateralFilter(claheResult, filtered, 5, 50, 50);

            // Deskewing: detect dominant angle using Hough lines
            const deskewed = this.deskewImage(filtered);
            if (deskewed && deskewed !== filtered) {
                mats.push(deskewed);
            }
            const inputForThresh = deskewed || filtered;

            // Adaptive thresholding
            const thresh = new cv.Mat();
            mats.push(thresh);
            cv.adaptiveThreshold(
                inputForThresh, thresh, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY,
                11, 2
            );

            // Morphological operations to connect broken characters
            const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 1));
            mats.push(kernel);
            const morphed = new cv.Mat();
            mats.push(morphed);
            cv.morphologyEx(thresh, morphed, cv.MORPH_CLOSE, kernel);

            // Create output canvas
            const outputCanvas = document.createElement('canvas');
            cv.imshow(outputCanvas, morphed);

            return outputCanvas;
        } catch (error) {
            console.error('Preprocessing error:', error);
            return canvas;
        } finally {
            // FIXED: Release all mats in finally block
            mats.forEach(mat => {
                try { mat.delete(); } catch (e) { /* ignore */ }
            });
        }
    }

    // Deskew image using Hough line detection
    deskewImage(src) {
        const mats = [];
        try {
            if (!window.cv) return null;

            const edges = new cv.Mat();
            mats.push(edges);
            cv.Canny(src, edges, 50, 150);

            const lines = new cv.Mat();
            mats.push(lines);
            cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, 50, 10);

            if (lines.rows === 0) return null;

            // Find dominant angle
            let angles = [];
            for (let i = 0; i < lines.rows; i++) {
                const x1 = lines.data32S[i * 4];
                const y1 = lines.data32S[i * 4 + 1];
                const x2 = lines.data32S[i * 4 + 2];
                const y2 = lines.data32S[i * 4 + 3];
                const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                // Only consider near-horizontal lines (within 15 degrees)
                if (Math.abs(angle) < 15) {
                    angles.push(angle);
                }
            }

            if (angles.length === 0) return null;

            // Median angle
            angles.sort((a, b) => a - b);
            const medianAngle = angles[Math.floor(angles.length / 2)];

            // Only deskew if angle is significant (>0.5 degrees)
            if (Math.abs(medianAngle) < 0.5) return null;

            console.log(`Deskewing by ${medianAngle.toFixed(2)} degrees`);

            const center = new cv.Point(src.cols / 2, src.rows / 2);
            const rotMatrix = cv.getRotationMatrix2D(center, medianAngle, 1.0);
            mats.push(rotMatrix);

            const deskewed = new cv.Mat();
            cv.warpAffine(src, deskewed, rotMatrix, new cv.Size(src.cols, src.rows),
                cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

            return deskewed;
        } catch (error) {
            console.warn('Deskew failed:', error);
            return null;
        } finally {
            mats.forEach(mat => {
                try { mat.delete(); } catch (e) { /* ignore */ }
            });
        }
    }

    // ==================== OCR Extraction ====================

    // Single-pass OCR optimized for MRZ
    async extractMRZText(canvas) {
        if (!window.Tesseract) {
            throw new Error('Tesseract.js not loaded. Please refresh the page.');
        }

        try {
            // Primary: PSM 6 (uniform block) with MRZ whitelist
            const result = await this.runOCRPass(canvas, '6', 'Reading document', true);

            if (result && this.cleanMRZText(result.text).length >= 60) {
                console.log(`OCR succeeded: length=${result.text.length}, confidence=${result.confidence}`);
                return result.text;
            }

            // Fallback: PSM 6 WITHOUT whitelist (whitelist can cause Tesseract to
            // drop characters entirely in some builds, especially the < filler)
            console.log('Whitelist OCR insufficient, retrying without whitelist...');
            this.updateOCRProgress(50, 'Retrying scan...');
            const fallback = await this.runOCRPass(canvas, '6', 'Retrying scan', false);

            if (fallback && this.cleanMRZText(fallback.text).length >= 30) {
                return fallback.text;
            }

            return result?.text || fallback?.text || null;
        } catch (error) {
            console.error('OCR error:', error);
            return null;
        }
    }

    async runOCRPass(canvas, psmMode, statusLabel, useWhitelist) {
        try {
            const config = {
                logger: m => {
                    if (m.status === 'recognizing text' && m.progress) {
                        this.updateOCRProgress(Math.round(m.progress * 100), statusLabel + '...');
                    }
                },
                tessedit_pageseg_mode: psmMode,
                preserve_interword_spaces: '1',
                user_defined_dpi: '300'
            };

            if (useWhitelist) {
                config.tessedit_char_whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';
            }

            const { data: { text, confidence } } = await Tesseract.recognize(canvas, 'eng', config);
            console.log(`OCR PSM${psmMode} wl=${useWhitelist}: "${text.substring(0, 80)}..." conf=${confidence}`);
            return { text, confidence: confidence || 0 };
        } catch (err) {
            console.warn(`OCR PSM ${psmMode} failed:`, err);
            return null;
        }
    }

    updateOCRProgress(percent, statusText) {
        const fill = document.getElementById('mrzProgressFill');
        const status = document.getElementById('mrzProgressStatus');
        if (fill) fill.style.width = percent + '%';
        if (status) status.textContent = statusText;
    }

    // ==================== MRZ Parsing ====================

    // TD1 parsing - FIXED: checksum validation for document number length
    parseTD1(lines) {
        try {
            if (lines.length < 3) return null;

            const line1 = this.padLine(lines[0], 30);
            const line2 = this.padLine(lines[1], 30);
            const line3 = this.padLine(lines[2], 30);

            console.log('Parsing TD1 lines:', { line1, line2, line3 });

            // ID Number (positions 5-14) - use checksum to validate length
            let idNumber = line1.substring(5, 14).replace(/</g, '');
            const idCheckDigit = parseInt(line1.charAt(14));

            // Try 9-char document number first
            let id9 = this.cleanMRZField(line1.substring(5, 14).replace(/</g, ''), 'numeric');
            const calc9 = this.calculateMRZCheckDigit(line1.substring(5, 14));
            if (calc9 === idCheckDigit) {
                idNumber = id9;
            } else {
                // Try with optional character at position 15
                let id10 = this.cleanMRZField(line1.substring(5, 15).replace(/</g, ''), 'numeric');
                idNumber = id10 || id9;
            }

            // Date of Birth (positions 0-6 in line 2)
            const dobStr = this.cleanMRZField(line2.substring(0, 6), 'numeric');
            const dob = this.parseMRZDate(dobStr, 'birth');

            // Gender (position 7 in line 2)
            const gender = line2.charAt(7);

            // Expiry Date (positions 8-14 in line 2)
            const expiryStr = this.cleanMRZField(line2.substring(8, 14), 'numeric');
            const expiry = this.parseMRZDate(expiryStr, 'expiry');

            // Nationality (positions 15-17 in line 2)
            const nationality = line2.substring(15, 18).replace(/</g, '').trim();

            // Names from line 3 (format: SURNAME<<FIRSTNAME<MIDDLE)
            const nameParts = line3.split('<<');
            let lastName = '';
            let firstName = '';

            if (nameParts.length >= 1) {
                lastName = this.cleanMRZField(nameParts[0].replace(/</g, ' ').trim(), 'alpha');
            }
            if (nameParts.length >= 2) {
                firstName = this.cleanMRZField(nameParts[1].replace(/</g, ' ').trim(), 'alpha');
            }

            if (!firstName && lastName.includes('<')) {
                const altParts = line3.split('<').filter(p => p.trim());
                if (altParts.length >= 2) {
                    lastName = this.cleanMRZField(altParts[0], 'alpha');
                    firstName = this.cleanMRZField(altParts.slice(1).join(' '), 'alpha');
                }
            }

            return {
                first_name: firstName || 'UNKNOWN',
                last_name: lastName || 'UNKNOWN',
                id_number: idNumber || 'UNKNOWN',
                date_of_birth: dob,
                gender: this.parseGender(gender),
                expiry_date: expiry,
                nationality: nationality || 'BW',
                raw_lines: [line1, line2, line3]
            };
        } catch (error) {
            console.error('TD1 parsing error:', error);
            return null;
        }
    }

    parseTD3(lines) {
        try {
            if (lines.length < 2) return null;

            const line1 = this.padLine(lines[0], 44);
            const line2 = this.padLine(lines[1], 44);

            // Names (positions 5-44 in line 1)
            const nameSection = line1.substring(5, 44);
            const nameParts = nameSection.split('<<');
            let lastName = this.cleanMRZField(nameParts[0]?.replace(/</g, ' ').trim() || '', 'alpha');
            let firstName = this.cleanMRZField(nameParts[1]?.replace(/</g, ' ').trim() || '', 'alpha');

            // Passport Number (positions 0-9 in line 2)
            const idNumber = this.cleanMRZField(line2.substring(0, 9).replace(/</g, '').trim(), 'numeric');

            // Nationality (positions 10-13 in line 2)
            const nationality = line2.substring(10, 13).replace(/</g, '').trim();

            // Date of Birth (positions 13-19 in line 2)
            const dobStr = this.cleanMRZField(line2.substring(13, 19), 'numeric');
            const dob = this.parseMRZDate(dobStr, 'birth');

            // Gender (position 20 in line 2)
            const gender = line2.charAt(20);

            // Expiry Date (positions 21-27 in line 2)
            const expiryStr = this.cleanMRZField(line2.substring(21, 27), 'numeric');
            const expiry = this.parseMRZDate(expiryStr, 'expiry');

            return {
                first_name: firstName || 'UNKNOWN',
                last_name: lastName || 'UNKNOWN',
                id_number: idNumber || 'UNKNOWN',
                date_of_birth: dob,
                gender: this.parseGender(gender),
                expiry_date: expiry,
                nationality: nationality || 'UNKNOWN',
                raw_lines: [line1, line2]
            };
        } catch (error) {
            console.error('TD3 parsing error:', error);
            return null;
        }
    }

    parseTD2(lines) {
        try {
            if (lines.length < 2) return null;

            const line1 = this.padLine(lines[0], 36);
            const line2 = this.padLine(lines[1], 36);

            const nameSection = line1.substring(5, 36);
            const nameParts = nameSection.split('<<');
            let lastName = this.cleanMRZField(nameParts[0]?.replace(/</g, ' ').trim() || '', 'alpha');
            let firstName = this.cleanMRZField(nameParts[1]?.replace(/</g, ' ').trim() || '', 'alpha');

            const idNumber = this.cleanMRZField(line2.substring(0, 9).replace(/</g, '').trim(), 'numeric');
            const nationality = line2.substring(10, 13).replace(/</g, '').trim();

            const dobStr = this.cleanMRZField(line2.substring(13, 19), 'numeric');
            const dob = this.parseMRZDate(dobStr, 'birth');

            const gender = line2.charAt(20);

            const expiryStr = this.cleanMRZField(line2.substring(21, 27), 'numeric');
            const expiry = this.parseMRZDate(expiryStr, 'expiry');

            return {
                first_name: firstName || 'UNKNOWN',
                last_name: lastName || 'UNKNOWN',
                id_number: idNumber || 'UNKNOWN',
                date_of_birth: dob,
                gender: this.parseGender(gender),
                expiry_date: expiry,
                nationality: nationality || 'UNKNOWN',
                raw_lines: [line1, line2]
            };
        } catch (error) {
            console.error('TD2 parsing error:', error);
            return null;
        }
    }

    // ==================== MRZ Helpers ====================

    padLine(line, length) {
        return (line || '').padEnd(length, '<').substring(0, length);
    }

    // FIXED: Context-aware century determination
    parseMRZDate(dateStr, context) {
        try {
            if (!dateStr || dateStr.length < 6) return 'UNKNOWN';

            const year = parseInt(dateStr.substring(0, 2));
            const month = parseInt(dateStr.substring(2, 4));
            const day = parseInt(dateStr.substring(4, 6));

            // Validate month and day ranges
            if (month < 1 || month > 12) return 'UNKNOWN';
            if (day < 1 || day > 31) return 'UNKNOWN';

            // Context-aware century determination
            const currentYear = new Date().getFullYear();
            const currentTwoDigitYear = currentYear % 100;
            let fullYear;

            if (context === 'expiry') {
                // Expiry dates: future-biased. Anything within next 30 years is 2000s
                fullYear = year <= (currentTwoDigitYear + 30) % 100 ? 2000 + year : 1900 + year;
            } else {
                // Birth dates: use current year as pivot
                fullYear = year > currentTwoDigitYear ? 1900 + year : 2000 + year;
            }

            const monthStr = String(month).padStart(2, '0');
            const dayStr = String(day).padStart(2, '0');

            return `${fullYear}-${monthStr}-${dayStr}`;
        } catch (error) {
            console.error('Date parsing error:', error);
            return 'UNKNOWN';
        }
    }

    parseGender(code) {
        if (code === 'M' || code === 'm') return 'M';
        if (code === 'F' || code === 'f') return 'F';
        return 'X';
    }

    // ==================== MRZ Checksum Validation ====================

    calculateMRZCheckDigit(input) {
        const weights = [7, 3, 1];
        const charValues = {
            '<': 0, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
            '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
            'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15,
            'G': 16, 'H': 17, 'I': 18, 'J': 19, 'K': 20, 'L': 21,
            'M': 22, 'N': 23, 'O': 24, 'P': 25, 'Q': 26, 'R': 27,
            'S': 28, 'T': 29, 'U': 30, 'V': 31, 'W': 32, 'X': 33,
            'Y': 34, 'Z': 35
        };

        let sum = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            const value = charValues[char] !== undefined ? charValues[char] : 0;
            const weight = weights[i % 3];
            sum += value * weight;
        }

        return sum % 10;
    }

    validateMRZChecksums(data, lines, documentType) {
        const validation = {
            valid: true,
            errors: [],
            warnings: []
        };

        try {
            if (documentType === 'TD1' && lines.length >= 2) {
                const line1 = lines[0];
                const line2 = lines[1];

                // Document number check digit (position 14 in line 1)
                const docNum = line1.substring(5, 14);
                const docCheck = parseInt(line1.charAt(14));
                const docCalc = this.calculateMRZCheckDigit(docNum);
                if (!isNaN(docCheck) && docCheck !== docCalc) {
                    validation.warnings.push(`Document number checksum mismatch (expected ${docCalc}, got ${docCheck})`);
                }

                // DOB check digit (position 6 in line 2)
                const dob = line2.substring(0, 6);
                const dobCheck = parseInt(line2.charAt(6));
                const dobCalc = this.calculateMRZCheckDigit(dob);
                if (!isNaN(dobCheck) && dobCheck !== dobCalc) {
                    validation.warnings.push(`DOB checksum mismatch (expected ${dobCalc}, got ${dobCheck})`);
                }

                // Expiry check digit (position 14 in line 2)
                const expiry = line2.substring(8, 14);
                const expCheck = parseInt(line2.charAt(14));
                const expCalc = this.calculateMRZCheckDigit(expiry);
                if (!isNaN(expCheck) && expCheck !== expCalc) {
                    validation.warnings.push(`Expiry date checksum mismatch (expected ${expCalc}, got ${expCheck})`);
                }

                // Composite check digit (position 29 in line 2)
                const composite = line1.substring(5, 30) + line2.substring(0, 7) + line2.substring(8, 15) + line2.substring(18, 29);
                const compCheck = parseInt(line2.charAt(29));
                const compCalc = this.calculateMRZCheckDigit(composite);
                if (!isNaN(compCheck) && compCheck !== compCalc) {
                    validation.warnings.push(`Composite checksum mismatch (expected ${compCalc}, got ${compCheck})`);
                }
            }

            // TD3 checksum validation
            if (documentType === 'TD3' && lines.length >= 2) {
                const line2 = lines[1];

                // Passport number check digit (position 9)
                const passNum = line2.substring(0, 9);
                const passCheck = parseInt(line2.charAt(9));
                const passCalc = this.calculateMRZCheckDigit(passNum);
                if (!isNaN(passCheck) && passCheck !== passCalc) {
                    validation.warnings.push(`Passport number checksum mismatch (expected ${passCalc}, got ${passCheck})`);
                }

                // DOB check digit (position 19)
                const dob = line2.substring(13, 19);
                const dobCheck = parseInt(line2.charAt(19));
                const dobCalc = this.calculateMRZCheckDigit(dob);
                if (!isNaN(dobCheck) && dobCheck !== dobCalc) {
                    validation.warnings.push(`DOB checksum mismatch (expected ${dobCalc}, got ${dobCheck})`);
                }

                // Expiry check digit (position 27)
                const expiry = line2.substring(21, 27);
                const expCheck = parseInt(line2.charAt(27));
                const expCalc = this.calculateMRZCheckDigit(expiry);
                if (!isNaN(expCheck) && expCheck !== expCalc) {
                    validation.warnings.push(`Expiry checksum mismatch (expected ${expCalc}, got ${expCheck})`);
                }

                // Composite check (position 43)
                const composite = line2.substring(0, 10) + line2.substring(13, 20) + line2.substring(21, 43);
                const compCheck = parseInt(line2.charAt(43));
                const compCalc = this.calculateMRZCheckDigit(composite);
                if (!isNaN(compCheck) && compCheck !== compCalc) {
                    validation.warnings.push(`Composite checksum mismatch (expected ${compCalc}, got ${compCheck})`);
                }
            }

            // TD2 checksum validation
            if (documentType === 'TD2' && lines.length >= 2) {
                const line2 = lines[1];

                // Document number check digit (position 9)
                const docNum = line2.substring(0, 9);
                const docCheck = parseInt(line2.charAt(9));
                const docCalc = this.calculateMRZCheckDigit(docNum);
                if (!isNaN(docCheck) && docCheck !== docCalc) {
                    validation.warnings.push(`Document number checksum mismatch (expected ${docCalc}, got ${docCheck})`);
                }

                // DOB check digit (position 19)
                const dob = line2.substring(13, 19);
                const dobCheck = parseInt(line2.charAt(19));
                const dobCalc = this.calculateMRZCheckDigit(dob);
                if (!isNaN(dobCheck) && dobCheck !== dobCalc) {
                    validation.warnings.push(`DOB checksum mismatch (expected ${dobCalc}, got ${dobCheck})`);
                }

                // Expiry check digit (position 27)
                const expiry = line2.substring(21, 27);
                const expCheck = parseInt(line2.charAt(27));
                const expCalc = this.calculateMRZCheckDigit(expiry);
                if (!isNaN(expCheck) && expCheck !== expCalc) {
                    validation.warnings.push(`Expiry checksum mismatch (expected ${expCalc}, got ${expCheck})`);
                }
            }
        } catch (error) {
            validation.warnings.push('Could not validate checksums: ' + error.message);
        }

        return validation;
    }

    calculateMRZQuality(parsedData, lines, documentType, checksumValidation) {
        let score = 0;
        const maxScore = 100;
        const issues = [];

        // 1. Text length match (20 points)
        const expectedLengths = { 'TD1': 90, 'TD2': 72, 'TD3': 88 };
        const totalLength = lines.join('').length;
        const expectedLength = expectedLengths[documentType.split(' ')[0]] || 90;
        const lengthDiff = Math.abs(totalLength - expectedLength);

        if (lengthDiff === 0) {
            score += 20;
        } else if (lengthDiff <= 5) {
            score += 15;
            issues.push('Minor length mismatch');
        } else if (lengthDiff <= 10) {
            score += 10;
            issues.push('Moderate length mismatch');
        } else {
            issues.push('Significant length mismatch');
        }

        // 2. Checksum validation (30 points)
        const checksumErrors = checksumValidation.warnings.length;
        if (checksumErrors === 0) {
            score += 30;
        } else if (checksumErrors === 1) {
            score += 20;
            issues.push('1 checksum warning');
        } else if (checksumErrors === 2) {
            score += 10;
            issues.push(`${checksumErrors} checksum warnings`);
        } else {
            issues.push(`${checksumErrors} checksum failures`);
        }

        // 3. Field completeness (30 points)
        const requiredFields = ['first_name', 'last_name', 'id_number', 'date_of_birth'];
        const missingFields = requiredFields.filter(f =>
            !parsedData[f] || parsedData[f] === 'UNKNOWN'
        );

        if (missingFields.length === 0) {
            score += 30;
        } else if (missingFields.length === 1) {
            score += 20;
            issues.push(`Missing: ${missingFields[0]}`);
        } else {
            score += 10;
            issues.push(`Missing ${missingFields.length} fields`);
        }

        // 4. Character plausibility (20 points)
        const nameHasNumbers = /\d/.test(parsedData.first_name + parsedData.last_name);
        const idHasLetters = /[A-Z]/.test(parsedData.id_number || '');

        if (!nameHasNumbers && !idHasLetters) {
            score += 20;
        } else if (nameHasNumbers || idHasLetters) {
            score += 10;
            if (nameHasNumbers) issues.push('Name contains numbers');
            if (idHasLetters) issues.push('ID contains letters');
        }

        // Determine quality level using design system colors
        let quality = 'Low';
        let qualityColor = 'var(--color-error)';

        if (score >= 80) {
            quality = 'High';
            qualityColor = 'var(--color-success)';
        } else if (score >= 60) {
            quality = 'Medium';
            qualityColor = 'var(--color-warning)';
        }

        return {
            score, maxScore,
            percentage: Math.round((score / maxScore) * 100),
            quality, qualityColor, issues
        };
    }

    // ==================== Phase B: Front-of-ID (Portrait) ====================

    async captureIDFront() {
        const video = document.getElementById('video-front');
        const canvas = document.getElementById('canvas-front');
        const ctx = canvas.getContext('2d');

        try {
            await this.waitForVideoReady(video);
        } catch (error) {
            this.showPhaseError('portraitResult', 'Camera Not Ready', 'Please wait a moment and try again.', 'captureIDFront');
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        const container = video.closest('.camera-container');

        // Trigger flash
        this.triggerFlash(container);

        // Freeze frame with scanning animation
        this.showCapturePreview(container, canvas);

        this.capturedImages.idFront = canvas.toDataURL('image/jpeg', 0.85);

        // Show processing status
        const portraitResult = document.getElementById('portraitResult');
        portraitResult.innerHTML = `
            <div class="processing-status-bar">
                <p class="processing-status">Detecting portrait...</p>
            </div>
        `;
        portraitResult.classList.remove('hidden');

        // Ensure face models are loaded
        if (window.faceapi && !faceapi.nets.tinyFaceDetector.isLoaded) {
            await this.loadFaceModels();
        }

        await this.extractPortrait(canvas);
    }

    async extractPortrait(canvas) {
        try {
            const img = new Image();
            img.src = canvas.toDataURL('image/jpeg');
            await new Promise((resolve) => { img.onload = resolve; });

            // Use SSD MobileNet (much more robust for ID card photos) with fallback to Tiny
            let detection = null;

            if (faceapi.nets.ssdMobilenetv1.isLoaded) {
                detection = await faceapi
                    .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();
            }

            // Fallback to TinyFaceDetector with low threshold
            if (!detection) {
                detection = await faceapi
                    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({
                        inputSize: 512,
                        scoreThreshold: 0.3
                    }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();
            }

            if (!detection) {
                throw new Error('No face detected on ID card. Please ensure the portrait is clearly visible and well-lit.');
            }

            const box = detection.detection.box;
            const padding = 20;

            const portraitCanvas = document.createElement('canvas');
            const ctx = portraitCanvas.getContext('2d');

            portraitCanvas.width = box.width + (padding * 2);
            portraitCanvas.height = box.height + (padding * 2);

            ctx.drawImage(
                canvas,
                box.x - padding, box.y - padding,
                box.width + (padding * 2), box.height + (padding * 2),
                0, 0,
                portraitCanvas.width, portraitCanvas.height
            );

            this.capturedImages.portrait = portraitCanvas.toDataURL('image/jpeg', 0.85);

            if (!detection.descriptor || detection.descriptor.length !== 128) {
                throw new Error('No face descriptor could be extracted. Please try again with better lighting.');
            }

            // Convert Float32Array to regular Array for consistent validation later
            this.extractedData.portraitDescriptor = Array.from(detection.descriptor);

            // --- Done: hide camera/scan UI, show results only ---
            const cameraContainer = document.getElementById('video-front')?.closest('.camera-container');
            if (cameraContainer) cameraContainer.style.display = 'none';
            const captureBtn = document.getElementById('captureFront')?.closest('.controls');
            if (captureBtn) captureBtn.style.display = 'none';

            document.getElementById('portraitResult').innerHTML = `
                <div class="success-message">
                    <strong><i class="fa-solid fa-circle-check"></i> Portrait Extracted Successfully</strong>
                    <p>Face detected and isolated from ID card</p>
                </div>
                <div class="preview-box">
                    <img src="${this.capturedImages.portrait}" alt="Extracted Portrait">
                    <p>Extracted Portrait</p>
                </div>
                <div class="controls">
                    <button class="btn-success" data-action="goToPhase" data-param="3">Continue to Live Selfie <i class="fa-solid fa-arrow-right"></i></button>
                </div>
            `;
        } catch (error) {
            console.error('Portrait extraction error:', error);
            // Restore live camera so user can retry
            const container = document.getElementById('video-front')?.closest('.camera-container');
            this.hideCapturePreview(container);
            this.showPhaseError('portraitResult', 'Error Extracting Portrait', error.message, 'captureIDFront');
        }
    }

    // ==================== Phase C: Live Selfie & Liveness ====================

    // FIXED: Removed Promise wrapper, added guard flag, uses { once: true }
    async captureSelfie() {
        if (this._selfieInProgress) {
            console.warn('Selfie capture already in progress');
            return;
        }
        this._selfieInProgress = true;

        const video = document.getElementById('video-selfie');

        // Ensure face models are loaded
        if (window.faceapi && !faceapi.nets.tinyFaceDetector.isLoaded) {
            await this.loadFaceModels();
        }

        // Show instructions for 3-pose capture
        const selfieResult = document.getElementById('selfieResult');
        selfieResult.innerHTML = `
            <div class="pose-instructions">
                <h3>Liveness Verification</h3>
                <p>We need to verify you're physically present by capturing 3 photos:</p>
                <div class="pose-steps">
                    <div class="pose-step">
                        <span class="step-number">1</span>
                        <span class="step-text">Look straight at the camera</span>
                    </div>
                    <div class="pose-step">
                        <span class="step-number">2</span>
                        <span class="step-text">Turn your head slightly LEFT</span>
                    </div>
                    <div class="pose-step">
                        <span class="step-number">3</span>
                        <span class="step-text">Turn your head slightly RIGHT</span>
                    </div>
                </div>
                <button id="startPoseCapture" class="btn-primary">Start Verification</button>
            </div>
        `;
        selfieResult.classList.remove('hidden');

        // Use { once: true } to prevent handler stacking
        document.getElementById('startPoseCapture').addEventListener('click', async () => {
            try {
                const poseResults = await this.captureThreePoses(video);

                const livenessResult = await this.analyzeThreePoses(poseResults);

                const frontPose = poseResults.find(p => p.name === 'front');
                const matchResult = await this.compareFaces(frontPose.canvas);

                if (!matchResult.isMatch) {
                    throw new Error(`Face verification failed. The selfie doesn't match the ID portrait closely enough (distance: ${matchResult.distance.toFixed(2)}).`);
                }

                if (!livenessResult.isLive) {
                    throw new Error(`Liveness check failed: ${livenessResult.reason}`);
                }

                this.extractedData.biometrics = {
                    match_score: matchResult.score,
                    is_live: livenessResult.isLive,
                    verification_status: 'verified',
                    liveness_score: livenessResult.confidence,
                    pose_analysis: livenessResult.details
                };

                // Save front pose as selfie (reduced quality for memory)
                this.capturedImages.selfie = frontPose.canvas.toDataURL('image/jpeg', 0.85);

                // Clean up pose canvases
                poseResults.forEach(p => { p.canvas = null; });

                this.displayPoseVerificationResults(livenessResult, matchResult, poseResults);
                this.populateForm();
            } catch (error) {
                console.error('Pose verification error:', error);
                this.showPhaseError('selfieResult', 'Verification Failed',
                    error.message + (error.message.includes('static')
                        ? '<p class="tip">The system detected a possible photo attack. Please ensure you are physically present.</p>'
                        : ''),
                    'captureSelfie');
            } finally {
                this._selfieInProgress = false;
            }
        }, { once: true });
    }

    // Capture 3 poses (front, left, right)
    async captureThreePoses(video) {
        const poses = [
            { name: 'front', instruction: 'Look straight at the camera', targetAngle: 'center' },
            { name: 'left', instruction: 'Turn your head slightly LEFT', targetAngle: -20 },
            { name: 'right', instruction: 'Turn your head slightly RIGHT', targetAngle: 20 }
        ];

        const capturedPoses = [];

        for (let i = 0; i < poses.length; i++) {
            const pose = poses[i];

            document.getElementById('selfieResult').innerHTML = `
                <div class="pose-capture">
                    <div class="pose-progress">Pose ${i + 1} of 3</div>
                    <h3>${pose.instruction}</h3>
                    <div class="pose-preview">
                        <div class="pose-example pose-${pose.name}"></div>
                    </div>
                    <div class="countdown">Get ready...</div>
                    <p class="pose-tip">Hold still when countdown reaches 0</p>
                </div>
            `;

            await this.countdown(3);

            const poseCanvas = await this.capturePoseFrame(video);
            capturedPoses.push({
                name: pose.name,
                image: poseCanvas.toDataURL('image/jpeg', 0.85),
                canvas: poseCanvas,
                timestamp: Date.now(),
                targetAngle: pose.targetAngle
            });

            document.getElementById('selfieResult').innerHTML += `
                <div class="pose-captured">
                    <div class="pose-check"><i class="fa-solid fa-circle-check"></i></div>
                    <p>Pose ${i + 1} captured successfully</p>
                    <img src="${poseCanvas.toDataURL('image/jpeg', 0.3)}" alt="Pose ${i + 1}" width="80">
                </div>
            `;

            if (i < poses.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return capturedPoses;
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const countdownEl = document.querySelector('.countdown');
            if (countdownEl) {
                countdownEl.textContent = i + '...';
                countdownEl.style.color = i <= 1 ? 'var(--color-error)' : 'var(--color-primary)';
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const countdownEl = document.querySelector('.countdown');
        if (countdownEl) {
            countdownEl.textContent = 'Capture!';
            countdownEl.style.color = 'var(--color-error)';
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    async capturePoseFrame(video) {
        await this.waitForVideoReady(video);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        return canvas;
    }

    // ==================== Liveness Analysis ====================

    async analyzeThreePoses(poses) {
        try {
            if (poses.length !== 3) {
                return {
                    isLive: false, confidence: 0,
                    reason: 'Need exactly 3 poses for verification'
                };
            }

            const poseAnalyses = await Promise.all(
                poses.map(pose => this.analyzeSinglePose(pose))
            );

            const validPoses = poseAnalyses.filter(p => p.detected);
            if (validPoses.length < 3) {
                return {
                    isLive: false, confidence: 0,
                    reason: `Only ${validPoses.length} of 3 poses detected a face`
                };
            }

            const consistency = await this.checkPoseConsistency(poses, poseAnalyses);
            const angleResults = this.checkPoseAngles(poseAnalyses);
            const isStatic = this.detectStaticPicture(poseAnalyses, consistency);
            const livenessScore = this.calculateLivenessScore(poseAnalyses, consistency, angleResults, isStatic);

            const isLive = livenessScore >= 0.7 && !isStatic;

            return {
                isLive, confidence: livenessScore,
                reason: isStatic ?
                    'Possible static picture detected' :
                    (isLive ? 'Live person verified with 3-pose check' : 'Insufficient pose variation'),
                details: {
                    poseAnalyses, consistency, angleResults,
                    isStaticPicture: isStatic
                }
            };
        } catch (error) {
            console.error('Pose analysis error:', error);
            return {
                isLive: false, confidence: 0,
                reason: 'Pose analysis failed: ' + error.message
            };
        }
    }

    async analyzeSinglePose(pose) {
        try {
            const img = new Image();
            img.src = pose.image;
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });

            const detection = await faceapi
                .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({
                    inputSize: 320,
                    scoreThreshold: 0.5
                }))
                .withFaceLandmarks();

            if (!detection) {
                return {
                    pose: pose.name, detected: false,
                    reason: 'No face detected'
                };
            }

            const landmarks = detection.landmarks;
            const box = detection.detection.box;

            const angle = this.calculateFaceAngle(landmarks.positions);
            const quality = this.calculateFaceQuality(landmarks, box, img);

            return {
                pose: pose.name, detected: true,
                confidence: detection.detection.score,
                angle, targetAngle: pose.targetAngle,
                quality, timestamp: pose.timestamp
            };
        } catch (error) {
            return {
                pose: pose.name, detected: false,
                reason: error.message
            };
        }
    }

    // FIXED: All return paths include { yaw, eyeDistance, quality, error }
    calculateFaceAngle(landmarks) {
        try {
            if (!landmarks || landmarks.length < 68) {
                console.warn('Invalid landmarks array, expected 68 points');
                return { yaw: 0, eyeDistance: 0, quality: 'invalid', error: 'Insufficient landmarks' };
            }

            const leftEye = landmarks[36];
            const rightEye = landmarks[45];

            if (!leftEye || !rightEye) {
                return { yaw: 0, eyeDistance: 0, quality: 'invalid', error: 'Missing eye landmarks' };
            }

            const eyeCenterX = (leftEye.x + rightEye.x) / 2;
            const eyeDistance = Math.abs(rightEye.x - leftEye.x);

            if (eyeDistance < 10) {
                console.warn('Eye distance too small, face may be too far or occluded');
                return { yaw: 0, eyeDistance, quality: 'poor', error: 'Face too small or occluded' };
            }

            const noseTip = landmarks[30];
            if (!noseTip) {
                return { yaw: 0, eyeDistance, quality: 'invalid', error: 'Missing nose landmark' };
            }

            const noseOffset = noseTip.x - eyeCenterX;
            let yaw = (noseOffset / eyeDistance) * 45;
            yaw = Math.max(-45, Math.min(45, yaw));

            let quality = 'good';
            if (eyeDistance < 30) {
                quality = 'poor';
            } else if (eyeDistance < 50) {
                quality = 'fair';
            }

            return { yaw: Math.round(yaw), eyeDistance, quality, error: null };
        } catch (error) {
            console.error('Angle calculation error:', error);
            return { yaw: 0, eyeDistance: 0, quality: 'error', error: error.message };
        }
    }

    calculateFaceQuality(landmarks, box, image) {
        const positions = landmarks.positions;

        const imageArea = image.width * image.height;
        const faceArea = box.width * box.height;
        const sizeRatio = faceArea / imageArea;

        const aspectRatio = box.width / box.height;

        const leftEyeY = positions[36].y;
        const rightEyeY = positions[45].y;
        const eyeLevelDiff = Math.abs(leftEyeY - rightEyeY);

        const sizeScore = sizeRatio >= 0.1 && sizeRatio <= 0.4 ? 1 : 0.5;
        const aspectScore = aspectRatio >= 0.6 && aspectRatio <= 1.0 ? 1 : 0.5;
        const eyeScore = Math.max(0, 1 - eyeLevelDiff / 20);

        return {
            score: (sizeScore + aspectScore + eyeScore) / 3,
            sizeRatio, aspectRatio, eyeLevelDiff
        };
    }

    // FIXED: null safety for descriptors array
    async checkPoseConsistency(poses, analyses) {
        try {
            const descriptors = [];
            for (let i = 0; i < poses.length; i++) {
                if (!analyses[i] || !analyses[i].detected) continue;

                const img = new Image();
                img.src = poses[i].image;
                await new Promise(resolve => {
                    img.onload = resolve;
                    img.onerror = () => resolve();
                });

                const detection = await faceapi
                    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
                    .withFaceDescriptor();

                if (detection) {
                    descriptors.push(detection.descriptor);
                }
            }

            if (descriptors.length < 2) {
                return { score: 0, reason: 'Not enough descriptors for comparison' };
            }

            let totalDistance = 0;
            let comparisons = 0;

            for (let i = 0; i < descriptors.length; i++) {
                for (let j = i + 1; j < descriptors.length; j++) {
                    const distance = faceapi.euclideanDistance(descriptors[i], descriptors[j]);
                    totalDistance += distance;
                    comparisons++;
                }
            }

            const avgDistance = totalDistance / comparisons;
            const consistencyScore = 1 - Math.min(avgDistance, 1);

            return {
                score: consistencyScore, avgDistance, comparisons,
                reason: consistencyScore >= 0.7 ?
                    'Same person detected across poses' :
                    'Face consistency check failed'
            };
        } catch (error) {
            return { score: 0, reason: 'Consistency check error: ' + error.message };
        }
    }

    // FIXED: null safety for analysis.angle
    checkPoseAngles(analyses) {
        let totalScore = 0;
        let angleDetails = [];

        analyses.forEach(analysis => {
            if (analysis.detected && analysis.angle) {
                let poseScore = 0;
                let reason = '';
                let match = false;

                const yaw = analysis.angle.yaw || 0;

                if (analysis.targetAngle === 'center') {
                    const deviation = Math.abs(yaw);

                    if (deviation <= 10) {
                        poseScore = 1.0;
                        reason = 'Perfect front-facing pose';
                        match = true;
                    } else if (deviation <= 15) {
                        poseScore = 0.8;
                        reason = `Good front pose (${deviation} deviation)`;
                        match = true;
                    } else if (deviation <= 20) {
                        poseScore = 0.5;
                        reason = `Acceptable front pose (${deviation} deviation)`;
                    } else if (deviation <= 30) {
                        poseScore = 0.2;
                        reason = `Poor front pose (${deviation} deviation, should be < 15)`;
                    } else {
                        poseScore = 0;
                        reason = `Face too rotated (${deviation}, should be < 15)`;
                    }
                } else {
                    const actualYaw = yaw;
                    const targetYaw = analysis.targetAngle;

                    const directionMatch = (targetYaw < 0 && actualYaw < 0) ||
                                         (targetYaw > 0 && actualYaw > 0);

                    if (!directionMatch) {
                        poseScore = 0.1;
                        reason = `Wrong direction: turned ${actualYaw > 0 ? 'right' : 'left'} instead of ${targetYaw > 0 ? 'right' : 'left'}`;
                    } else {
                        const angleDiff = Math.abs(actualYaw - targetYaw);

                        if (angleDiff <= 10) {
                            poseScore = 1.0;
                            reason = `Perfect ${analysis.pose} pose`;
                            match = true;
                        } else if (angleDiff <= 15) {
                            poseScore = 0.8;
                            reason = `Good ${analysis.pose} pose`;
                            match = true;
                        } else if (angleDiff <= 25) {
                            poseScore = 0.6;
                            reason = `Acceptable ${analysis.pose} pose`;
                        } else if (angleDiff <= 35) {
                            poseScore = 0.3;
                            reason = `Poor ${analysis.pose} pose`;
                        } else {
                            poseScore = 0.1;
                            reason = `Insufficient rotation`;
                        }

                        const magnitude = Math.abs(actualYaw);
                        if (magnitude >= 15) {
                            poseScore *= 1.1;
                            poseScore = Math.min(poseScore, 1.0);
                        }
                    }
                }

                totalScore += poseScore;
                angleDetails.push({
                    pose: analysis.pose,
                    actualAngle: yaw,
                    targetAngle: analysis.targetAngle,
                    poseScore: poseScore.toFixed(2),
                    match, reason
                });
            }
        });

        const validCount = angleDetails.length || 1;
        const finalScore = totalScore / validCount;

        return {
            score: finalScore,
            details: angleDetails,
            allMatch: angleDetails.every(d => d.match),
            reason: finalScore >= 0.8 ?
                'Excellent pose angles' :
                (finalScore >= 0.6 ?
                    'Good pose angles with minor deviations' :
                    'Insufficient pose angle variation')
        };
    }

    detectStaticPicture(analyses, consistency) {
        const tooConsistent = consistency.score > 0.97;
        const consistencyWeight = tooConsistent ? 2.0 : 0;

        const perfectAngles = analyses.filter(a =>
            a.detected && a.angle &&
            Math.abs((a.angle.yaw || 0) - (a.targetAngle === 'center' ? 0 : a.targetAngle)) < 5
        ).length;
        const angleWeight = perfectAngles >= 3 ? 1.5 : (perfectAngles >= 2 ? 1.0 : 0);

        const timestamps = analyses.map(a => a.timestamp).filter(Boolean).sort();
        const timeDiffs = [];
        for (let i = 1; i < timestamps.length; i++) {
            timeDiffs.push(timestamps[i] - timestamps[i - 1]);
        }
        const avgTimeDiff = timeDiffs.length > 0 ? timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length : Infinity;
        const tooFast = avgTimeDiff < 800;
        const timingWeight = tooFast ? 1.0 : 0;

        const qualityScores = analyses.filter(a => a.detected && a.quality).map(a => a.quality.score);
        const qualityVariance = this.calculateVariance(qualityScores);
        const noVariation = qualityVariance < 0.002;
        const varianceWeight = noVariation ? 1.0 : 0;

        const totalWeight = consistencyWeight + angleWeight + timingWeight + varianceWeight;
        const maxPossibleWeight = 5.5;

        return totalWeight / maxPossibleWeight > 0.5;
    }

    calculateVariance(values) {
        if (values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b) / values.length;
        return values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    }

    calculateLivenessScore(analyses, consistency, angleResults, isStatic) {
        const detectionScore = analyses.filter(a => a.detected).length / analyses.length;
        const qualityScore = analyses.reduce((sum, a) => sum + (a.detected && a.quality ? a.quality.score : 0), 0) / analyses.length;
        const confidenceScore = analyses.reduce((sum, a) => sum + (a.detected ? a.confidence : 0), 0) / analyses.length;

        let totalScore = (
            detectionScore * 0.3 +
            qualityScore * 0.2 +
            confidenceScore * 0.1 +
            consistency.score * 0.2 +
            angleResults.score * 0.2
        );

        if (isStatic) {
            totalScore *= 0.5;
        }

        return totalScore;
    }

    displayPoseVerificationResults(livenessResult, matchResult, poses) {
        const poseDetails = poses.map(pose => `
            <div class="pose-thumbnail-item">
                <img src="${pose.image}" alt="${pose.name} pose">
                <span>${pose.name}</span>
            </div>
        `).join('');

        const analysisDetails = livenessResult.details.poseAnalyses.map(analysis => `
            <div class="pose-analysis ${analysis.detected ? 'detected' : 'failed'}">
                <strong>${analysis.pose}:</strong>
                ${analysis.detected ?
                    `<i class="fa-solid fa-circle-check"></i> Detected (${analysis.confidence.toFixed(2)})<br>
                     Angle: ${analysis.angle ? analysis.angle.yaw : 'N/A'}` :
                    `<i class="fa-solid fa-circle-xmark"></i> ${analysis.reason}`}
            </div>
        `).join('');

        document.getElementById('selfieResult').innerHTML = `
            <div class="${livenessResult.isLive ? 'success-message' : 'warning-message'}">
                <strong>${livenessResult.isLive ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-triangle-exclamation"></i>'} 3-Pose Verification</strong>
                <p>${livenessResult.reason}</p>
                <p>Overall Score: ${(livenessResult.confidence * 100).toFixed(1)}%</p>
            </div>

            <div class="result-card">
                <h4>Captured Poses</h4>
                <div class="pose-thumbnails">
                    ${poseDetails}
                </div>

                <h4>Analysis Results</h4>
                ${analysisDetails}

                <div class="pose-analysis">
                    <strong>Face Consistency:</strong>
                    ${(livenessResult.details.consistency.score * 100).toFixed(1)}%
                    - ${livenessResult.details.consistency.reason}
                </div>

                <div class="pose-analysis">
                    <strong>Angle Matching:</strong>
                    ${(livenessResult.details.angleResults.score * 100).toFixed(1)}%
                    - ${livenessResult.details.angleResults.reason}
                </div>

                <div class="pose-analysis">
                    <strong>Face Matching:</strong>
                    ${(matchResult.score * 100).toFixed(1)}% match
                    ${matchResult.isMatch ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle-xmark"></i>'}
                </div>

                ${livenessResult.details.isStaticPicture ? `
                    <div class="static-warning">
                        <i class="fa-solid fa-triangle-exclamation"></i> The system detected characteristics of a static picture.
                        Please ensure you are physically present.
                    </div>
                ` : ''}
            </div>

            <div class="controls">
                <button class="btn-success" data-action="goToPhase" data-param="4">Continue to Review <i class="fa-solid fa-arrow-right"></i></button>
            </div>
        `;
    }

    async compareFaces(selfieCanvas) {
        try {
            if (!this.extractedData.portraitDescriptor) {
                throw new Error('No portrait descriptor found. Please recapture ID front.');
            }

            const pd = this.extractedData.portraitDescriptor;
            if (!pd || pd.length !== 128) {
                throw new Error('Invalid portrait descriptor. Please recapture ID front.');
            }

            const selfieImg = new Image();
            selfieImg.src = selfieCanvas.toDataURL('image/jpeg');
            await new Promise((resolve) => { selfieImg.onload = resolve; });

            // Use SSD MobileNet (same as portrait extraction) for consistent descriptors
            let selfieDetection = null;
            if (faceapi.nets.ssdMobilenetv1.isLoaded) {
                selfieDetection = await faceapi
                    .detectSingleFace(selfieImg, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();
            }
            // Fallback to TinyFaceDetector
            if (!selfieDetection) {
                selfieDetection = await faceapi
                    .detectSingleFace(selfieImg, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();
            }

            if (!selfieDetection) {
                throw new Error('No face detected in selfie');
            }

            if (!selfieDetection.descriptor || selfieDetection.descriptor.length !== 128) {
                throw new Error('Invalid selfie descriptor. Please try again.');
            }

            const portraitDescriptor = this.extractedData.portraitDescriptor;
            const selfieDescriptor = selfieDetection.descriptor;

            const distance = faceapi.euclideanDistance(portraitDescriptor, selfieDescriptor);
            // FaceAPI euclidean distance: < 0.6 = same person (standard threshold)
            // Convert to a 0-1 similarity score for display purposes
            const maxReasonableDistance = 1.2;
            const similarity = Math.max(0, 1 - (distance / maxReasonableDistance));
            const distanceThreshold = 0.6; // Standard faceapi threshold

            return {
                score: similarity,
                isMatch: distance < distanceThreshold,
                distance: distance
            };
        } catch (error) {
            console.error('Face comparison error:', error);
            throw error;
        }
    }

    // ==================== Phase D: Review & Submit ====================

    populateForm() {
        document.getElementById('firstName').value = this.extractedData.first_name || '';
        document.getElementById('lastName').value = this.extractedData.last_name || '';
        document.getElementById('idNumber').value = this.extractedData.id_number || '';
        document.getElementById('dateOfBirth').value = this.extractedData.date_of_birth || '';
        document.getElementById('gender').value = this.extractedData.gender || '';
        document.getElementById('nationality').value = this.extractedData.nationality || '';

        const previewHTML = `
            <div class="preview-box">
                <img src="${this.capturedImages.portrait}" alt="ID Portrait">
                <p>ID Portrait</p>
            </div>
            <div class="preview-box">
                <img src="${this.capturedImages.selfie}" alt="Live Selfie">
                <p>Live Selfie</p>
            </div>
        `;
        document.getElementById('previewImages').innerHTML = previewHTML;

        const dataHTML = `
            <h3>Extracted Information</h3>
            <div class="result-item">
                <span class="result-label">Document Type:</span>
                <span class="result-value">${this.documentType}</span>
            </div>
            <div class="result-item">
                <span class="result-label">Biometric Match:</span>
                <span class="result-value">${(this.extractedData.biometrics.match_score * 100).toFixed(1)}%</span>
            </div>
            <div class="result-item">
                <span class="result-label">Liveness Status:</span>
                <span class="result-value"><span class="status-badge status-success">Verified</span></span>
            </div>
        `;
        document.getElementById('extractedData').innerHTML = dataHTML;
    }

    async submitRegistration() {
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        // Read form values (user may have edited readonly fields)
        const registrationData = {
            status: 'success',
            data: {
                first_name: document.getElementById('firstName').value || this.extractedData.first_name,
                last_name: document.getElementById('lastName').value || this.extractedData.last_name,
                id_number: document.getElementById('idNumber').value || this.extractedData.id_number,
                date_of_birth: document.getElementById('dateOfBirth').value || this.extractedData.date_of_birth,
                gender: document.getElementById('gender').value || this.extractedData.gender,
                expiry_date: this.extractedData.expiry_date,
                nationality: document.getElementById('nationality').value || this.extractedData.nationality
            },
            biometrics: {
                match_score: this.extractedData.biometrics.match_score,
                is_live: this.extractedData.biometrics.is_live,
                verification_status: this.extractedData.biometrics.verification_status
            },
            document_type: this.documentType,
            timestamp: new Date().toISOString()
        };

        console.log('Registration Data:', registrationData);

        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1500));

        document.getElementById('finalResult').innerHTML = `
            <div class="success-message">
                <h2><i class="fa-solid fa-circle-check"></i> Registration Complete!</h2>
                <p>Your identity has been successfully verified and your account has been created.</p>
            </div>
            <div class="result-card">
                <h3>Registration Summary</h3>
                <div class="result-item">
                    <span class="result-label">Full Name:</span>
                    <span class="result-value">${registrationData.data.first_name} ${registrationData.data.last_name}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">ID Number:</span>
                    <span class="result-value">${registrationData.data.id_number}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Verification Score:</span>
                    <span class="result-value">${(registrationData.biometrics.match_score * 100).toFixed(1)}%</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Status:</span>
                    <span class="result-value"><span class="status-badge status-success">Verified</span></span>
                </div>
            </div>
            <details>
                <summary class="result-card" style="cursor:pointer;font-weight:600;">
                    View JSON Output
                </summary>
                <pre style="background:var(--color-bg-code);padding:var(--spacing-md);border-radius:var(--radius-sm);overflow-x:auto;margin-top:var(--spacing-xs);font-size:var(--font-xs);">${JSON.stringify(registrationData, null, 2)}</pre>
            </details>
        `;
        document.getElementById('finalResult').classList.remove('hidden');
        document.getElementById('registrationForm').style.display = 'none';

        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
    }
}

// ==================== Dependency-Gated Initialization ====================

let app;

function initApp() {
    if (app) return; // Already initialized

    // Check that critical dependencies are available
    if (!window.Tesseract) {
        console.warn('Tesseract.js not yet loaded');
    }
    if (!window.faceapi) {
        console.warn('face-api.js not yet loaded');
    }

    console.log('Dependencies ready, initializing app...');
    app = new IdentityVerificationSystem();
    app.init();
}

// Listen for OpenCV ready event (dispatched from inline script in HTML)
window.addEventListener('opencv-ready', () => {
    console.log('OpenCV ready event received');
    // Mark OpenCV step done on the overlay even before app is created
    const el = document.getElementById('initCheckOpencv');
    if (el) {
        el.classList.add('done');
        const icon = el.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-circle-check';
    }
    initApp();
});

// Fallback: if OpenCV already loaded before this script ran, or if it never loads
window.addEventListener('load', () => {
    // Give OpenCV a moment to initialize if it hasn't already
    setTimeout(() => {
        if (!app) {
            console.log('Fallback initialization (OpenCV may not be available)');
            initApp();
        }
    }, 2000);
});
