import * as db from './src/database.js';

async function test() {
  try {
    console.log('Testing database connection...');
    await db.testConnection();
    console.log('✅ Database connection successful!');
    
    console.log('\nGetting database stats...');
    const stats = await db.getDatabaseStats();
    console.log('✅ Stats:', JSON.stringify(stats, null, 2));
    
    await db.closeDatabase();
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

test();
