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
        this.capturedPoses = []; // NEW: For storing 3 poses
        this.documentType = null;
        this.streams = {};

        this.init();
    }

    async init() {
        console.log('Initializing Identity Verification System...');

        // Load face detection models
        await this.loadFaceModels();

        // Setup event listeners
        this.setupEventListeners();

        // Start first camera - KEEPING YOUR ORIGINAL CODE
        await this.startCamera('video');
    }

    async loadFaceModels() {
        try {
            console.log('Loading face detection models...');
            const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';

            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
            await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
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
    }

    // CAMERA CODE - KEEPING EXACTLY AS YOUR ORIGINAL
    async startCamera(videoId) {
        try {
            const video = document.getElementById(videoId);

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

            console.log(`Camera started for ${videoId}`);
        } catch (error) {
            console.error('Camera access error:', error);
            alert('Unable to access camera. Please grant camera permissions.');
        }
    }

    stopCamera(videoId) {
        if (this.streams[videoId]) {
            this.streams[videoId].getTracks().forEach(track => track.stop());
            delete this.streams[videoId];
        }
    }

    async goToPhase(phaseNumber) {
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

        // Show target phase
        const phases = ['phase-back', 'phase-front', 'phase-selfie', 'phase-verification'];
        document.getElementById(phases[phaseNumber - 1]).classList.add('active');
        document.querySelector(`.step[data-step="${phaseNumber}"]`).classList.add('active');

        this.currentPhase = phaseNumber;

        // Start camera for new phase
        const newVideoId = this.getVideoIdForPhase(phaseNumber);
        if (newVideoId) {
            await this.startCamera(newVideoId);
        }
    }

    getVideoIdForPhase(phase) {
        const videoIds = ['video', 'video-front', 'video-selfie', null];
        return videoIds[phase - 1];
    }
    // END OF CAMERA CODE - NO CHANGES

    async captureIDBack() {
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        this.capturedImages.idBack = canvas.toDataURL('image/jpeg', 0.95);

        // Show processing message
        document.getElementById('mrzResult').innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Processing MRZ data...</p>
            </div>
        `;
        document.getElementById('mrzResult').style.display = 'block';

        // Process MRZ - USING FIXED VERSION
        await this.processMRZ(canvas);
    }

    // FIXED MRZ PROCESSING FUNCTIONS
    async processMRZ(canvas) {
        try {
            // Step 1: First try direct extraction
            const mrzText = await this.extractMRZText(canvas);

            if (!mrzText || mrzText.trim().length < 30) {
                // If direct extraction fails, try with preprocessing
                console.log('Direct extraction failed, trying with preprocessing...');
                const processedCanvas = await this.preprocessForMRZ(canvas);
                const processedText = await this.extractMRZText(processedCanvas);

                if (processedText && processedText.trim().length >= 30) {
                    return this.parseAndDisplayMRZ(processedText);
                } else {
                    throw new Error('Could not read MRZ. Please ensure good lighting and alignment.');
                }
            } else {
                return this.parseAndDisplayMRZ(mrzText);
            }

        } catch (error) {
            console.error('MRZ processing error:', error);
            document.getElementById('mrzResult').innerHTML = `
                <div class="error-message">
                    <strong>✗ MRZ Extraction Failed</strong>
                    <p>${error.message}</p>
                    <p class="tip">Tips: Ensure good lighting, hold ID steady, MRZ should be clearly visible</p>
                </div>
                <div class="controls">
                    <button class="btn-primary" onclick="app.captureIDBack()">Try Again</button>
                </div>
            `;
        }
    }

    async parseAndDisplayMRZ(rawText) {
        console.log('Raw OCR Text:', rawText);

        // Clean the text
        const cleanText = this.cleanMRZText(rawText);
        console.log('Cleaned Text:', cleanText);

        // Try different parsing strategies
        let parsedData = null;

        // Strategy 1: Try TD1 (3 lines of ~30 chars)
        if (cleanText.length >= 80) {
            const lines = this.splitIntoMRZLines(cleanText, 30, 3);
            parsedData = this.parseTD1(lines);
            if (parsedData) this.documentType = 'TD1 (Omang/ID Card)';
        }

        // Strategy 2: Try TD3 (2 lines of 44 chars)
        if (!parsedData && cleanText.length >= 80) {
            const lines = this.splitIntoMRZLines(cleanText, 44, 2);
            parsedData = this.parseTD3(lines);
            if (parsedData) this.documentType = 'TD3 (Passport)';
        }

        // Strategy 3: Try TD2 (2 lines of 36 chars)
        if (!parsedData && cleanText.length >= 70) {
            const lines = this.splitIntoMRZLines(cleanText, 36, 2);
            parsedData = this.parseTD2(lines);
            if (parsedData) this.documentType = 'TD2 (ID Card)';
        }

        if (!parsedData) {
            throw new Error('Could not parse MRZ data. Please ensure the MRZ is clearly visible.');
        }

        this.extractedData = { ...this.extractedData, ...parsedData };

        // Display results
        document.getElementById('mrzResult').innerHTML = `
            <div class="success-message">
                <strong>✓ MRZ Data Extracted Successfully</strong>
                <p>Document Type: ${this.documentType}</p>
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
                <button class="btn-success" onclick="app.goToPhase(2)">Continue to Front Scan →</button>
            </div>
        `;
    }

    // FIXED: Better text cleaning
    cleanMRZText(text) {
        return text
            .toUpperCase()
            .replace(/[^A-Z0-9<\n]/g, '')  // Keep only MRZ characters
            .replace(/\s+/g, '')           // Remove all whitespace
            .replace(/O/g, '0')            // Common OCR error: O vs 0
            .replace(/I/g, '1')            // Common OCR error: I vs 1
            .replace(/Z/g, '2')            // Common OCR error: Z vs 2
            .replace(/S/g, '5')            // Common OCR error: S vs 5
            .replace(/B/g, '8')            // Common OCR error: B vs 8
            .trim();
    }

    // FIXED: Split text into MRZ lines
    splitIntoMRZLines(text, lineLength, numLines) {
        const lines = [];
        for (let i = 0; i < numLines; i++) {
            const start = i * lineLength;
            const end = start + lineLength;
            if (start < text.length) {
                let line = text.substring(start, end);
                // Pad with < if too short
                if (line.length < lineLength) {
                    line = line.padEnd(lineLength, '<');
                }
                lines.push(line);
            }
        }
        return lines;
    }

    // FIXED: Simplified preprocessing
    async preprocessForMRZ(canvas) {
        try {
            if (!window.cv) {
                console.warn('OpenCV not available, using original canvas');
                return canvas;
            }

            const src = cv.imread(canvas);
            const gray = new cv.Mat();
            const processed = new cv.Mat();

            // Convert to grayscale
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Simple thresholding - works better than adaptive for MRZ
            cv.threshold(gray, processed, 128, 255, cv.THRESH_BINARY);

            // Create output canvas
            const outputCanvas = document.createElement('canvas');
            cv.imshow(outputCanvas, processed);

            // Cleanup
            src.delete();
            gray.delete();
            processed.delete();

            return outputCanvas;
        } catch (error) {
            console.error('Preprocessing error:', error);
            return canvas; // Return original if preprocessing fails
        }
    }

    // FIXED: Better OCR extraction
    async extractMRZText(canvas) {
        try {
            // Use Tesseract with optimal MRZ settings
            const { data: { text } } = await Tesseract.recognize(
                canvas,
                'eng',
                {
                    logger: m => console.log(m),
                    tessedit_pageseg_mode: '7',  // Single text line
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
                    tessedit_ocr_engine_mode: '1',  // Neural nets LSTM only
                    preserve_interword_spaces: '1',
                    user_defined_dpi: '300'
                }
            );

            return text;
        } catch (error) {
            console.error('OCR error:', error);
            return null;
        }
    }

    // FIXED: More robust TD1 parsing
    parseTD1(lines) {
        try {
            if (lines.length < 3) return null;

            // Pad lines to 30 characters
            const line1 = this.padLine(lines[0], 30);
            const line2 = this.padLine(lines[1], 30);
            const line3 = this.padLine(lines[2], 30);

            console.log('Parsing TD1 lines:', { line1, line2, line3 });

            // ID Number (positions 5-14)
            let idNumber = line1.substring(15, 23).replace(/</g, '').trim();

            // Date of Birth (positions 0-6 in line 2)
            const dobStr = line2.substring(0, 6);
            const dob = this.parseMRZDate(dobStr);

            // Gender (position 7 in line 2)
            const gender = line2.charAt(7);

            // Expiry Date (positions 8-14 in line 2)
            const expiryStr = line2.substring(8, 14);
            const expiry = this.parseMRZDate(expiryStr);

            // Nationality (positions 15-17 in line 2)
            const nationality = line2.substring(15, 18).replace(/</g, '').trim();

            // Names from line 3 (format: SURNAME<<FIRSTNAME<MIDDLE)
            const nameParts = line3.split('<<');
            let lastName = '';
            let firstName = '';

            if (nameParts.length >= 1) {
                lastName = nameParts[0].replace(/</g, ' ').trim();
            }
            if (nameParts.length >= 2) {
                firstName = nameParts[1].replace(/</g, ' ').trim();
            }

            // If no << separator found, try to split by <
            if (!firstName && lastName.includes('<')) {
                const altParts = line3.split('<').filter(p => p.trim());
                if (altParts.length >= 2) {
                    lastName = altParts[0];
                    firstName = altParts.slice(1).join(' ');
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

    // FIXED: Better TD3 parsing
    parseTD3(lines) {
        try {
            if (lines.length < 2) return null;

            const line1 = this.padLine(lines[0], 44);
            const line2 = this.padLine(lines[1], 44);

            // Names (positions 5-44 in line 1)
            const nameSection = line1.substring(5, 44);
            const nameParts = nameSection.split('<<');
            let lastName = nameParts[0]?.replace(/</g, ' ').trim() || '';
            let firstName = nameParts[1]?.replace(/</g, ' ').trim() || '';

            // ID/Passport Number (positions 0-9 in line 2)
            const idNumber = line2.substring(0, 9).replace(/</g, '').trim();

            // Nationality (positions 10-13 in line 2)
            const nationality = line2.substring(10, 13).replace(/</g, '').trim();

            // Date of Birth (positions 13-19 in line 2)
            const dobStr = line2.substring(13, 19);
            const dob = this.parseMRZDate(dobStr);

            // Gender (position 20 in line 2)
            const gender = line2.charAt(20);

            // Expiry Date (positions 21-27 in line 2)
            const expiryStr = line2.substring(21, 27);
            const expiry = this.parseMRZDate(expiryStr);

            return {
                first_name: firstName || 'UNKNOWN',
                last_name: lastName || 'UNKNOWN',
                id_number: idNumber || 'UNKNOWN',
                date_of_birth: dob,
                gender: this.parseGender(gender),
                expiry_date: expiry,
                nationality: nationality || 'UNKNOWN'
            };
        } catch (error) {
            console.error('TD3 parsing error:', error);
            return null;
        }
    }

    // FIXED: Better TD2 parsing
    parseTD2(lines) {
        try {
            if (lines.length < 2) return null;

            const line1 = this.padLine(lines[0], 36);
            const line2 = this.padLine(lines[1], 36);

            // Similar to TD3 but shorter
            const nameSection = line1.substring(5, 36);
            const nameParts = nameSection.split('<<');
            let lastName = nameParts[0]?.replace(/</g, ' ').trim() || '';
            let firstName = nameParts[1]?.replace(/</g, ' ').trim() || '';

            // ID Number (positions 0-9 in line 2)
            const idNumber = line2.substring(0, 9).replace(/</g, '').trim();

            // Nationality (positions 10-13 in line 2)
            const nationality = line2.substring(10, 13).replace(/</g, '').trim();

            // Date of Birth (positions 13-19 in line 2)
            const dobStr = line2.substring(13, 19);
            const dob = this.parseMRZDate(dobStr);

            // Gender (position 20 in line 2)
            const gender = line2.charAt(20);

            // Expiry Date (positions 21-27 in line 2)
            const expiryStr = line2.substring(21, 27);
            const expiry = this.parseMRZDate(expiryStr);

            return {
                first_name: firstName || 'UNKNOWN',
                last_name: lastName || 'UNKNOWN',
                id_number: idNumber || 'UNKNOWN',
                date_of_birth: dob,
                gender: this.parseGender(gender),
                expiry_date: expiry,
                nationality: nationality || 'UNKNOWN'
            };
        } catch (error) {
            console.error('TD2 parsing error:', error);
            return null;
        }
    }

    // Helper functions
    padLine(line, length) {
        return (line || '').padEnd(length, '<').substring(0, length);
    }

    parseMRZDate(dateStr) {
        try {
            if (!dateStr || dateStr.length < 6) return 'UNKNOWN';

            const year = parseInt(dateStr.substring(0, 2));
            const month = dateStr.substring(2, 4);
            const day = dateStr.substring(4, 6);

            // Determine century (common heuristic)
            const fullYear = year > 30 ? 1900 + year : 2000 + year;

            return `${fullYear}-${month}-${day}`;
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

    // REST OF YOUR ORIGINAL CODE - KEPT EXACTLY AS IS
    async captureIDFront() {
        const video = document.getElementById('video-front');
        const canvas = document.getElementById('canvas-front');
        const ctx = canvas.getContext('2d');

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        this.capturedImages.idFront = canvas.toDataURL('image/jpeg', 0.95);

        // Show processing message
        document.getElementById('portraitResult').innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Detecting and extracting portrait...</p>
            </div>
        `;
        document.getElementById('portraitResult').style.display = 'block';

        // Extract portrait
        await this.extractPortrait(canvas);
    }

    async extractPortrait(canvas) {
        try {
            const img = new Image();
            img.src = canvas.toDataURL('image/jpeg');
            await new Promise((resolve) => {
                img.onload = resolve;
            });

            const detection = await faceapi
                .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detection) {
                throw new Error('No face detected on ID card. Please ensure the portrait is clearly visible.');
            }

            // Extract face region with padding
            const box = detection.detection.box;
            const padding = 20;

            const portraitCanvas = document.createElement('canvas');
            const ctx = portraitCanvas.getContext('2d');

            portraitCanvas.width = box.width + (padding * 2);
            portraitCanvas.height = box.height + (padding * 2);

            ctx.drawImage(
                canvas,
                box.x - padding,
                box.y - padding,
                box.width + (padding * 2),
                box.height + (padding * 2),
                0,
                0,
                portraitCanvas.width,
                portraitCanvas.height
            );

            this.capturedImages.portrait = portraitCanvas.toDataURL('image/jpeg', 0.95);
            this.extractedData.portraitDescriptor = detection.descriptor;

            // Display results
            document.getElementById('portraitResult').innerHTML = `
                <div class="success-message">
                    <strong>✓ Portrait Extracted Successfully</strong>
                    <p>Face detected and isolated from ID card</p>
                </div>
                <div class="preview-box">
                    <img src="${this.capturedImages.portrait}" alt="Extracted Portrait">
                    <p>Extracted Portrait</p>
                </div>
                <div class="controls">
                    <button class="btn-success" onclick="app.goToPhase(3)">Continue to Live Selfie →</button>
                </div>
            `;
        } catch (error) {
            console.error('Portrait extraction error:', error);
            document.getElementById('portraitResult').innerHTML = `
                <div class="error-message">
                    <strong>✗ Error Extracting Portrait</strong>
                    <p>${error.message}</p>
                </div>
                <div class="controls">
                    <button class="btn-primary" onclick="app.captureIDFront()">Try Again</button>
                </div>
            `;
        }
    }

    // =============== REPLACED: NEW 3-POSE LIVENESS DETECTION ===============
    async captureSelfie() {
        const video = document.getElementById('video-selfie');

        // Show instructions for 3-pose capture
        document.getElementById('selfieResult').innerHTML = `
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
        document.getElementById('selfieResult').style.display = 'block';

        // Wait for user to start the 3-pose capture
        return new Promise((resolve) => {
            document.getElementById('startPoseCapture').onclick = async () => {
                try {
                    // Capture 3 poses
                    const poseResults = await this.captureThreePoses(video);

                    // Analyze poses for liveness
                    const livenessResult = await this.analyzeThreePoses(poseResults);

                    // Use the front pose for face matching
                    const frontPose = poseResults.find(p => p.name === 'front');
                    const matchResult = await this.compareFaces(frontPose.canvas);

                    if (!matchResult.isMatch) {
                        throw new Error(`Face verification failed. Match score: ${(matchResult.score * 100).toFixed(1)}%. Minimum required: 85%`);
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

                    // Save front pose as selfie
                    this.capturedImages.selfie = frontPose.canvas.toDataURL('image/jpeg', 0.95);

                    // Display success results
                    this.displayPoseVerificationResults(livenessResult, matchResult, poseResults);

                    // Populate form with extracted data
                    this.populateForm();

                } catch (error) {
                    console.error('Pose verification error:', error);
                    document.getElementById('selfieResult').innerHTML = `
                        <div class="error-message">
                            <strong>✗ Verification Failed</strong>
                            <p>${error.message}</p>
                            ${error.message.includes('static') ?
                                '<p class="tip">The system detected a possible photo attack. Please ensure you are physically present.</p>' : ''}
                        </div>
                        <div class="controls">
                            <button class="btn-primary" onclick="app.captureSelfie()">Try Again</button>
                        </div>
                    `;
                }
            };
        });
    }

    // NEW: Capture 3 poses (front, left, right)
    async captureThreePoses(video) {
        const poses = [
            { name: 'front', instruction: 'Look straight at the camera', targetAngle: 'center' },
            { name: 'left', instruction: 'Turn your head slightly LEFT', targetAngle: -20 },
            { name: 'right', instruction: 'Turn your head slightly RIGHT', targetAngle: 20 }
        ];

        const capturedPoses = [];

        for (let i = 0; i < poses.length; i++) {
            const pose = poses[i];

            // Update instruction UI
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

            // 3-second countdown
            await this.countdown(3);

            // Capture the pose
            const poseCanvas = await this.capturePoseFrame(video);
            capturedPoses.push({
                name: pose.name,
                image: poseCanvas.toDataURL('image/jpeg', 0.95),
                canvas: poseCanvas,
                timestamp: Date.now(),
                targetAngle: pose.targetAngle
            });

            // Show captured preview
            document.getElementById('selfieResult').innerHTML += `
                <div class="pose-captured">
                    <div class="pose-check">✓</div>
                    <p>Pose ${i + 1} captured successfully</p>
                    <img src="${poseCanvas.toDataURL('image/jpeg', 0.3)}" alt="Pose ${i + 1}" width="80">
                </div>
            `;

            // Brief pause between poses (unless it's the last one)
            if (i < poses.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return capturedPoses;
    }

    // Helper: Countdown timer
    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const countdownEl = document.querySelector('.countdown');
            if (countdownEl) {
                countdownEl.textContent = i + '...';
                countdownEl.style.color = i <= 3 ? '#ff4757' : '#4CAF50';
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const countdownEl = document.querySelector('.countdown');
        if (countdownEl) {
            countdownEl.textContent = 'Capture!';
            countdownEl.style.color = '#ff4757';
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Helper: Capture single frame
    async capturePoseFrame(video) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        return canvas;
    }

    // NEW: Analyze the 3 poses for liveness
    async analyzeThreePoses(poses) {
        try {
            if (poses.length !== 3) {
                return {
                    isLive: false,
                    confidence: 0,
                    reason: 'Need exactly 3 poses for verification'
                };
            }

            // Analyze each pose
            const poseAnalyses = await Promise.all(
                poses.map(pose => this.analyzeSinglePose(pose))
            );

            // Check if all poses detected faces
            const validPoses = poseAnalyses.filter(p => p.detected);
            if (validPoses.length < 3) {
                return {
                    isLive: false,
                    confidence: 0,
                    reason: `Only ${validPoses.length} of 3 poses detected a face`
                };
            }

            // Check face consistency across poses
            const consistency = await this.checkPoseConsistency(poses, poseAnalyses);

            // Check if poses show appropriate angles
            const angleResults = this.checkPoseAngles(poseAnalyses);

            // Check for static picture indicators
            const isStatic = this.detectStaticPicture(poseAnalyses, consistency);

            // Calculate overall liveness score
            const livenessScore = this.calculateLivenessScore(poseAnalyses, consistency, angleResults, isStatic);

            const isLive = livenessScore >= 0.7 && !isStatic;

            return {
                isLive,
                confidence: livenessScore,
                reason: isStatic ?
                    'Possible static picture detected' :
                    (isLive ? 'Live person verified with 3-pose check' : 'Insufficient pose variation'),
                details: {
                    poseAnalyses,
                    consistency,
                    angleResults,
                    isStaticPicture: isStatic
                }
            };

        } catch (error) {
            console.error('Pose analysis error:', error);
            return {
                isLive: false,
                confidence: 0,
                reason: 'Pose analysis failed: ' + error.message
            };
        }
    }

    // Analyze a single pose
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
                    pose: pose.name,
                    detected: false,
                    reason: 'No face detected'
                };
            }

            const landmarks = detection.landmarks;
            const box = detection.detection.box;

            // Calculate face angle
            const angle = this.calculateFaceAngle(landmarks.positions);

            // Calculate face quality
            const quality = this.calculateFaceQuality(landmarks, box, img);

            return {
                pose: pose.name,
                detected: true,
                confidence: detection.detection.score,
                angle,
                targetAngle: pose.targetAngle,
                quality,
                timestamp: pose.timestamp
            };

        } catch (error) {
            return {
                pose: pose.name,
                detected: false,
                reason: error.message
            };
        }
    }

    // Calculate face rotation angle
    calculateFaceAngle(landmarks) {
        // Simplified angle calculation using eye positions
        const leftEye = landmarks[36];  // Left eye corner
        const rightEye = landmarks[45]; // Right eye corner

        const eyeCenterX = (leftEye.x + rightEye.x) / 2;
        const eyeDistance = Math.abs(rightEye.x - leftEye.x);

        // Use nose position to determine rotation
        const noseTip = landmarks[30];
        const noseOffset = noseTip.x - eyeCenterX;

        // Estimate yaw angle (-30 to 30 degrees)
        const yaw = (noseOffset / eyeDistance) * 45;

        return {
            yaw: Math.round(yaw),
            eyeDistance
        };
    }

    // Calculate face quality metrics
    calculateFaceQuality(landmarks, box, image) {
        const positions = landmarks.positions;

        // Face size relative to image
        const imageArea = image.width * image.height;
        const faceArea = box.width * box.height;
        const sizeRatio = faceArea / imageArea;

        // Aspect ratio
        const aspectRatio = box.width / box.height;

        // Eye alignment
        const leftEyeY = positions[36].y;
        const rightEyeY = positions[45].y;
        const eyeLevelDiff = Math.abs(leftEyeY - rightEyeY);

        // Overall quality score (0-1)
        const sizeScore = sizeRatio >= 0.1 && sizeRatio <= 0.4 ? 1 : 0.5;
        const aspectScore = aspectRatio >= 0.6 && aspectRatio <= 1.0 ? 1 : 0.5;
        const eyeScore = Math.max(0, 1 - eyeLevelDiff / 20);

        return {
            score: (sizeScore + aspectScore + eyeScore) / 3,
            sizeRatio,
            aspectRatio,
            eyeLevelDiff
        };
    }

    // Check consistency across poses
    async checkPoseConsistency(poses, analyses) {
        try {
            // Extract face descriptors for each pose
            const descriptors = [];
            for (let i = 0; i < poses.length; i++) {
                if (analyses[i].detected) {
                    const img = new Image();
                    img.src = poses[i].image;
                    await new Promise(resolve => {
                        img.onload = resolve;
                        img.onerror = () => resolve(); // Skip on error
                    });

                    const detection = await faceapi
                        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
                        .withFaceDescriptor();

                    if (detection) {
                        descriptors.push(detection.descriptor);
                    }
                }
            }

            if (descriptors.length < 2) {
                return { score: 0, reason: 'Not enough descriptors for comparison' };
            }

            // Compare descriptors to ensure same person
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
                score: consistencyScore,
                avgDistance,
                comparisons,
                reason: consistencyScore >= 0.7 ?
                    'Same person detected across poses' :
                    'Face consistency check failed'
            };

        } catch (error) {
            return {
                score: 0,
                reason: 'Consistency check error: ' + error.message
            };
        }
    }

    // Check if poses match expected angles
    checkPoseAngles(analyses) {
        let angleScore = 0;
        let angleDetails = [];

        analyses.forEach(analysis => {
            if (analysis.detected) {
                let match = false;
                let reason = '';

                if (analysis.targetAngle === 'center') {
                    // Front pose: should have minimal rotation
                    match = Math.abs(analysis.angle.yaw) < 15;
                    reason = match ?
                        'Good front-facing pose' :
                        `Face rotated ${analysis.angle.yaw}° (should be < 15°)`;
                    angleScore += match ? 1 : 0.3;
                } else {
                    // Side poses: should have appropriate rotation
                    const angleDiff = Math.abs(analysis.angle.yaw - analysis.targetAngle);
                    match = angleDiff < 25;
                    const directionMatch = (analysis.targetAngle < 0 && analysis.angle.yaw < 0) ||
                                         (analysis.targetAngle > 0 && analysis.angle.yaw > 0);

                    reason = directionMatch ?
                        `Face rotated ${analysis.angle.yaw}° (target: ${analysis.targetAngle}°)` :
                        `Wrong direction: should be ${analysis.targetAngle > 0 ? 'right' : 'left'}`;

                    angleScore += match && directionMatch ? 1 : (directionMatch ? 0.5 : 0.2);
                }

                angleDetails.push({
                    pose: analysis.pose,
                    actualAngle: analysis.angle.yaw,
                    targetAngle: analysis.targetAngle,
                    match,
                    reason
                });
            }
        });

        const finalScore = angleScore / analyses.length;

        return {
            score: finalScore,
            details: angleDetails,
            allMatch: angleDetails.every(d => d.match),
            reason: finalScore >= 0.7 ?
                'Pose angles match expected positions' :
                'Insufficient pose angle variation'
        };
    }

    // Detect static picture indicators
    detectStaticPicture(analyses, consistency) {
        // Static picture indicators:

        // 1. Too perfect consistency (identical across all poses)
        const tooConsistent = consistency.score > 0.95;

        // 2. Perfect angle matches (unlikely in real captures)
        const perfectAngles = analyses.filter(a =>
            a.detected &&
            Math.abs(a.angle.yaw - (a.targetAngle === 'center' ? 0 : a.targetAngle)) < 5
        ).length;

        // 3. Timing - poses captured too quickly
        const timestamps = analyses.map(a => a.timestamp).sort();
        const timeDiffs = [];
        for (let i = 1; i < timestamps.length; i++) {
            timeDiffs.push(timestamps[i] - timestamps[i-1]);
        }
        const avgTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        const tooFast = avgTimeDiff < 800; // Less than 0.8s between poses

        // 4. No quality variations
        const qualityScores = analyses.map(a => a.quality.score);
        const qualityVariance = this.calculateVariance(qualityScores);
        const noVariation = qualityVariance < 0.001;

        // If multiple indicators suggest static picture
        const staticIndicators = [tooConsistent, perfectAngles >= 2, tooFast, noVariation];
        const staticCount = staticIndicators.filter(Boolean).length;

        return staticCount >= 2;
    }

    // Calculate variance helper
    calculateVariance(values) {
        if (values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b) / values.length;
        return values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    }

    // Calculate overall liveness score
    calculateLivenessScore(analyses, consistency, angleResults, isStatic) {
        // Component scores
        const detectionScore = analyses.filter(a => a.detected).length / analyses.length;
        const qualityScore = analyses.reduce((sum, a) => sum + (a.detected ? a.quality.score : 0), 0) / analyses.length;
        const confidenceScore = analyses.reduce((sum, a) => sum + (a.detected ? a.confidence : 0), 0) / analyses.length;

        // Combine scores with weights
        let totalScore = (
            detectionScore * 0.3 +        // All poses must detect face
            qualityScore * 0.2 +          // Face quality
            confidenceScore * 0.1 +        // Detection confidence
            consistency.score * 0.2 +     // Face consistency
            angleResults.score * 0.2      // Angle matching
        );

        // Penalize if static picture detected
        if (isStatic) {
            totalScore *= 0.5;
        }

        return totalScore;
    }

    // Display pose verification results
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
                    `✓ Detected (${analysis.confidence.toFixed(2)})<br>
                     Angle: ${analysis.angle.yaw}°` :
                    `✗ ${analysis.reason}`}
            </div>
        `).join('');

        document.getElementById('selfieResult').innerHTML = `
            <div class="${livenessResult.isLive ? 'success-message' : 'warning-message'}">
                <strong>${livenessResult.isLive ? '✓' : '⚠'} 3-Pose Verification</strong>
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
                    ${matchResult.isMatch ? '✓' : '✗'}
                </div>

                ${livenessResult.details.isStaticPicture ? `
                    <div class="static-warning">
                        ⚠️ The system detected characteristics of a static picture.
                        Please ensure you are physically present.
                    </div>
                ` : ''}
            </div>

            <div class="controls">
                <button class="btn-success" onclick="app.goToPhase(4)">Continue to Review →</button>
            </div>
        `;
    }

    // Keep your existing compareFaces method as is
    async compareFaces(selfieCanvas) {
        try {
            //const selfieImg = await faceapi.bufferToImage(selfieCanvas);

            const selfieImg = new Image();
                selfieImg.src = selfieCanvas.toDataURL('image/jpeg');
                await new Promise((resolve) => {
                selfieImg.onload = resolve;
            });

            const selfieDetection = await faceapi
                .detectSingleFace(selfieImg, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!selfieDetection) {
                throw new Error('No face detected in selfie');
            }

            // Compare with stored portrait descriptor
            const portraitDescriptor = this.extractedData.portraitDescriptor;
            const selfieDescriptor = selfieDetection.descriptor;

            // Calculate Euclidean distance
            const distance = faceapi.euclideanDistance(portraitDescriptor, selfieDescriptor);

            // Convert distance to similarity score (lower distance = higher similarity)
            const similarity = 1 - Math.min(distance, 1);
            const threshold = 0.85;

            return {
                score: similarity,
                isMatch: similarity >= threshold,
                distance: distance
            };
        } catch (error) {
            console.error('Face comparison error:', error);
            throw error;
        }
    }

    populateForm() {
        document.getElementById('firstName').value = this.extractedData.first_name || '';
        document.getElementById('lastName').value = this.extractedData.last_name || '';
        document.getElementById('idNumber').value = this.extractedData.id_number || '';
        document.getElementById('dateOfBirth').value = this.extractedData.date_of_birth || '';
        document.getElementById('gender').value = this.extractedData.gender || '';
        document.getElementById('nationality').value = this.extractedData.nationality || '';

        // Display preview images
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

        // Display extracted data summary
        const dataHTML = `
            <h3 style="margin-bottom: 15px;">Extracted Information</h3>
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
        submitBtn.innerHTML = '⏳ Processing...';

        // Prepare final data package
        const registrationData = {
            status: 'success',
            data: {
                first_name: this.extractedData.first_name,
                last_name: this.extractedData.last_name,
                id_number: this.extractedData.id_number,
                date_of_birth: this.extractedData.date_of_birth,
                gender: this.extractedData.gender,
                expiry_date: this.extractedData.expiry_date,
                nationality: this.extractedData.nationality
            },
            biometrics: this.extractedData.biometrics,
            document_type: this.documentType,
            images: {
                id_back: this.capturedImages.idBack,
                id_front: this.capturedImages.idFront,
                portrait: this.capturedImages.portrait,
                selfie: this.capturedImages.selfie
            },
            timestamp: new Date().toISOString()
        };

        console.log('Registration Data:', registrationData);

        // Simulate API call
        setTimeout(() => {
            document.getElementById('finalResult').innerHTML = `
                <div class="success-message">
                    <h2 style="margin-bottom: 15px;">✓ Registration Complete!</h2>
                    <p>Your identity has been successfully verified and your account has been created.</p>
                </div>
                <div class="result-card">
                    <h3 style="margin-bottom: 15px;">Registration Summary</h3>
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
                <details style="margin-top: 20px;">
                    <summary style="cursor: pointer; font-weight: 600; padding: 10px; background: #f5f5f5; border-radius: 8px;">
                        View JSON Output
                    </summary>
                    <pre style="background: #f5f5f5; padding: 15px; border-radius: 8px; overflow-x: auto; margin-top: 10px;">${JSON.stringify(registrationData, null, 2)}</pre>
                </details>
            `;
            document.getElementById('finalResult').style.display = 'block';
            document.getElementById('registrationForm').style.display = 'none';

            submitBtn.disabled = false;
            submitBtn.innerHTML = '✓ Complete Registration';
        }, 2000);
    }
}

// Initialize the application
let app;
window.addEventListener('load', () => {
    // Wait for OpenCV to load
    cv['onRuntimeInitialized'] = () => {
        console.log('OpenCV.js loaded');
        app = new IdentityVerificationSystem();
    };
});