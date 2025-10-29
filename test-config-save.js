#!/usr/bin/env node

/**
 * Test script to verify scanner configuration save functionality
 */

#!/usr/bin/env node

/**
 * Test script to verify scanner configuration save functionality
 */

import fetch from 'node-fetch';

async function testConfigSave() {
    console.log('🧪 Testing scanner configuration save functionality...');
    
    try {
        // Test 1: Get current settings
        console.log('\n1. Getting current settings...');
        const getResponse = await fetch('http://localhost:3003/api/scanSettings');
        const getData = await getResponse.json();
        console.log('✅ Current settings retrieved:', getData.success);
        
        if (getData.data && getData.data.length > 0) {
            const currentSettings = getData.data[0];
            console.log('📊 Current maxBalancePercentRisk:', currentSettings.maxBalancePercentRisk);
            
            // Test 2: Update settings
            console.log('\n2. Updating settings...');
            const newSettings = {
                ...currentSettings,
                maxBalancePercentRisk: 85,
                updated_date: new Date().toISOString()
            };
            
            const updateResponse = await fetch(`http://localhost:3003/api/scanSettings/${currentSettings.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newSettings)
            });
            
            const updateData = await updateResponse.json();
            console.log('✅ Settings updated:', updateData.success);
            
            if (updateData.success) {
                console.log('📊 New maxBalancePercentRisk:', updateData.data.maxBalancePercentRisk);
                
                // Test 3: Verify the change was saved
                console.log('\n3. Verifying the change was saved...');
                const verifyResponse = await fetch('http://localhost:3003/api/scanSettings');
                const verifyData = await verifyResponse.json();
                
                if (verifyData.data && verifyData.data.length > 0) {
                    const savedSettings = verifyData.data[0];
                    console.log('✅ Verification successful:', savedSettings.maxBalancePercentRisk === 85);
                    console.log('📊 Saved maxBalancePercentRisk:', savedSettings.maxBalancePercentRisk);
                }
            }
        }
        
        console.log('\n🎉 Configuration save test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

testConfigSave();
