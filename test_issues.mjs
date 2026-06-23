import fs from 'fs';

const issues = [];

// Test 1: Check for hardcoded demo data that should be dynamic
function checkDemoData() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  // Check for hardcoded names that should be dynamic
  const hardcodedNames = ['Marcus Kirkland', 'Alex Kim', 'Daniel Reyes', 'Derek Wu', 'Maria Lopez'];
  hardcodedNames.forEach(name => {
    const count = (html.match(new RegExp(name, 'g')) || []).length;
    if (count > 1) { // More than 1 appearance suggests hardcoding
      issues.push({
        severity: 'MEDIUM',
        category: 'Hardcoded Data',
        issue: `Hardcoded name "${name}" appears ${count} times - should be dynamic`
      });
    }
  });
}

// Test 2: Check database schema
function checkDatabaseFields() {
  const dbJs = fs.readFileSync('src/db/db.js', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  // Frontend expects daily_earnings but check if it's in database
  if (html.includes('daily_earnings') && !dbJs.includes('daily_earnings')) {
    issues.push({
      severity: 'CRITICAL',
      category: 'Database Schema Mismatch',
      issue: 'Frontend references profile.daily_earnings but database schema may not include it'
    });
  }

  // Check for other missing fields
  if (html.includes('profile.tier') && !dbJs.includes('tier')) {
    issues.push({
      severity: 'CRITICAL',
      category: 'Database Schema Mismatch',
      issue: 'Frontend references profile.tier but database schema may not include it'
    });
  }
}

// Test 3: Check incomplete features
function checkIncompleteFeatures() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  const comingSoonCount = (html.match(/coming soon/gi) || []).length;
  const alertCount = (html.match(/alert\(/g) || []).length;
  
  if (comingSoonCount > 0) {
    issues.push({
      severity: 'LOW',
      category: 'Incomplete Features',
      issue: `${comingSoonCount} "coming soon" features found (using alerts instead of real implementations)`
    });
  }
}

// Test 4: Check API endpoint alignment
function checkAPIEndpoints() {
  const deliveryRoutes = fs.readFileSync('src/routes/deliveries.js', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const apiClient = fs.readFileSync('public/api-client.js', 'utf8');
  
  // Check if all frontend API calls have backend routes
  const frontendCalls = (html.match(/FlashRush\.\w+\(/g) || []).map(m => m.replace(/FlashRush\./, '').replace(/\($/, ''));
  const uniqueCalls = new Set(frontendCalls);
  
  issues.push({
    severity: 'INFO',
    category: 'API Coverage',
    issue: `Frontend uses ${uniqueCalls.size} different API methods`
  });
}

// Test 5: Check for potential XSS vulnerabilities
function checkXSS() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  // Check for innerHTML without sanitization
  const innerHTMLCount = (html.match(/\.innerHTML\s*=/g) || []).length;
  if (innerHTMLCount > 50) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Security',
      issue: `${innerHTMLCount} innerHTML assignments found - check for XSS vulnerabilities`
    });
  }
}

// Test 6: Check offline queue implementation
function checkOfflineQueue() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  if (!html.includes('OFFLINE_QUEUE_KEY')) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Offline Support',
      issue: 'Offline queue not properly initialized'
    });
  }

  if (!html.includes('navigator.onLine')) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Offline Support',
      issue: 'Online/offline event listeners may not be set up correctly'
    });
  }
}

// Test 7: Check image handling for parcel photos
function checkImageHandling() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  if (html.includes('data:image') && html.includes('base64')) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Performance',
      issue: 'Parcel photos stored as base64 inline - will bloat database at scale'
    });
  }
}

// Test 8: Check geofence implementation
function checkGeofence() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const deliveryRoutes = fs.readFileSync('src/routes/deliveries.js', 'utf8');
  
  const clientGeofence = html.includes('GEOFENCE_METERS');
  const serverGeofence = deliveryRoutes.includes('GEOFENCE_M');
  
  if (!clientGeofence || !serverGeofence) {
    issues.push({
      severity: 'HIGH',
      category: 'Location Features',
      issue: 'Geofence implementation may be incomplete (missing client or server side)'
    });
  }
}

// Test 9: Check Stripe integration
function checkStripe() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const paymentsRoute = fs.readFileSync('src/routes/payments.js', 'utf8');
  
  if (!html.includes('stripe')) {
    issues.push({
      severity: 'HIGH',
      category: 'Payments',
      issue: 'Stripe not loaded in frontend'
    });
  }

  if (!paymentsRoute.includes('webhook')) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Payments',
      issue: 'Stripe webhook implementation may be incomplete'
    });
  }
}

// Test 10: Check for responsive design issues
function checkResponsiveness() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  
  if (!html.includes('viewport')) {
    issues.push({
      severity: 'HIGH',
      category: 'Mobile',
      issue: 'Missing viewport meta tag - app may not be mobile responsive'
    });
  }
}

// Run all tests
checkDemoData();
checkDatabaseFields();
checkIncompleteFeatures();
checkAPIEndpoints();
checkXSS();
checkOfflineQueue();
checkImageHandling();
checkGeofence();
checkStripe();
checkResponsiveness();

// Print results
console.log('=== ADDITIONAL ISSUES ANALYSIS ===\n');
const bySeverity = {};
issues.forEach((issue) => {
  if (!bySeverity[issue.severity]) bySeverity[issue.severity] = [];
  bySeverity[issue.severity].push(issue);
});

Object.keys(bySeverity).sort((a,b) => {
  const severity = {CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3, INFO:4};
  return severity[a] - severity[b];
}).forEach(sev => {
  console.log(`\n${sev} (${bySeverity[sev].length}):`);
  bySeverity[sev].forEach((issue, idx) => {
    console.log(`  ${idx+1}. [${issue.category}] ${issue.issue}`);
  });
});

console.log(`\nTotal issues found: ${issues.length}`);
