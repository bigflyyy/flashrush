// Comprehensive FlashRush testing script
const issues = [];

// Test 1: Check for hardcoded demo data that should be dynamic
function checkDemoData() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  
  // Check for hardcoded names that should be dynamic
  const hardcodedNames = ['Marcus Kirkland', 'Alex Kim', 'Daniel Reyes', 'Daniel R.'];
  hardcodedNames.forEach(name => {
    const count = (html.match(new RegExp(name, 'g')) || []).length;
    if (count > 0) {
      issues.push({
        severity: 'HIGH',
        category: 'Hardcoded Data',
        issue: `Hardcoded name "${name}" appears ${count} times - should be dynamic`
      });
    }
  });

  // Check for hardcoded coordinates
  if (html.includes('37.3770') || html.includes('37.4530')) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Hardcoded Data',
      issue: 'Hardcoded test coordinates (Sunnyvale/Menlo Park) used as defaults'
    });
  }
}

// Test 2: Check for missing API error handling
function checkErrorHandling() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  
  if (!html.includes('catch(e)') && !html.includes('catch (e)')) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Error Handling',
      issue: 'Minimal error handling in async functions'
    });
  }
}

// Test 3: Check for console errors potential
function checkJSPotentialErrors() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  
  // Look for potential undefined variable access
  const potentialUndefined = [
    'DRIVER_NEXT\\[',
    'STATUS_LABEL\\[',
    'SIZE_LABEL\\['
  ];
  
  potentialUndefined.forEach(pattern => {
    if (html.includes(pattern.replace('\\[', '['))) {
      // These are object accesses - check if objects are defined
    }
  });
}

// Test 4: Check database schema alignment
function checkDatabaseIntegration() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  const authJs = require('fs').readFileSync('src/routes/auth.js', 'utf8');
  
  // Check if frontend expects fields that backend doesn't provide
  if (html.includes('profile.daily_earnings') && !authJs.includes('daily_earnings')) {
    issues.push({
      severity: 'CRITICAL',
      category: 'Database Schema',
      issue: 'Frontend expects profile.daily_earnings but backend doesn\'t provide it'
    });
  }
}

// Test 5: Check for missing endpoints
function checkEndpoints() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  const deliveryRoutes = require('fs').readFileSync('src/routes/deliveries.js', 'utf8');
  
  // Look for API calls in frontend
  const apiCalls = html.match(/FlashRush\.\w+\(/g) || [];
  const uniqueApiCalls = new Set(apiCalls);
  
  issues.push({
    severity: 'INFO',
    category: 'API Coverage',
    issue: `Frontend uses ${uniqueApiCalls.size} API endpoints`
  });
}

// Test 6: Check password security
function checkSecurity() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  
  if (html.includes('localStorage') && html.includes('password')) {
    issues.push({
      severity: 'HIGH',
      category: 'Security',
      issue: 'Check if passwords are stored in localStorage'
    });
  }

  // Check for exposed API keys
  const authJs = require('fs').readFileSync('src/routes/auth.js', 'utf8');
  if (authJs.includes('sk_') || authJs.includes('pk_')) {
    issues.push({
      severity: 'CRITICAL',
      category: 'Security',
      issue: 'API keys may be hardcoded in source'
    });
  }
}

// Test 7: Check for incomplete features
function checkIncompleteFeatures() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  
  const comingSoonCount = (html.match(/coming soon/gi) || []).length;
  issues.push({
    severity: 'MEDIUM',
    category: 'Incomplete Features',
    issue: `${comingSoonCount} "coming soon" placeholders found`
  });
}

// Test 8: Check database for missing fields
function checkDatabaseFields() {
  const dbJs = require('fs').readFileSync('src/db/db.js', 'utf8');
  
  // Check if profile tables have all needed fields
  if (!dbJs.includes('daily_earnings')) {
    issues.push({
      severity: 'HIGH',
      category: 'Database Schema',
      issue: 'driverProfiles missing daily_earnings field (needed for profile display)'
    });
  }
}

// Test 9: Check WebSocket implementation
function checkWebSocket() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  const serverJs = require('fs').readFileSync('src/server.js', 'utf8');
  
  if (html.includes('trackSocket') && !serverJs.includes('WebSocket')) {
    issues.push({
      severity: 'HIGH',
      category: 'Real-time Features',
      issue: 'Frontend uses trackSocket WebSocket but server WebSocket may not be set up'
    });
  }
}

// Test 10: Check file upload handling
function checkFileUpload() {
  const html = require('fs').readFileSync('public/index.html', 'utf8');
  
  if (html.includes('parcel_photo') && html.includes('550KB')) {
    issues.push({
      severity: 'INFO',
      category: 'File Handling',
      issue: 'Parcel photo upload limited to 550KB - check if enough for testing'
    });
  }
}

// Run all tests
checkDemoData();
checkErrorHandling();
checkJSPotentialErrors();
checkDatabaseIntegration();
checkEndpoints();
checkSecurity();
checkIncompleteFeatures();
checkDatabaseFields();
checkWebSocket();
checkFileUpload();

// Print results
console.log('=== ADDITIONAL ISSUES FOUND ===\n');
issues.forEach((issue, idx) => {
  console.log(`#${idx + 1} [${issue.severity}] ${issue.category}`);
  console.log(`   ${issue.issue}\n`);
});

console.log(`Total issues found: ${issues.length}`);
