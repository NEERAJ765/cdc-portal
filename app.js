const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const bcrypt = require('bcrypt');
const multer = require('multer');
const bodyParser = require('body-parser');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/'); // Save files to uploads directory
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
    },
});


const upload = multer({ storage });

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'technova',
    password: 'root',
    port: 5432,
});
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err.stack);
    } else {
        console.log('Connected to PostgreSQL database:', res.rows[0]);
    }
});

app.get('/', (req, res) => {
    res.render('test');
});
app.get('/addmock', (req, res) => {
    res.render('addmock');
});
app.get('/practice', (req, res) => {
    res.render('practice');
});

//student database signup 

app.post('/register', async (req, res) => {
    const { jntuNumber, email, password, cgpa, branch } = req.body;

    // Input validation
    if (!jntuNumber || !email || !password || !cgpa || !branch) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Valid branches
    const validBranches = ["Computer Science", "Electronics", "Electrical", "Mechanical"];

    // Check if the branch is valid
    if (!validBranches.includes(branch)) {
        return res.status(400).json({ message: "Invalid branch selected" });
    }

    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into the database
        const query = `
            INSERT INTO students (jntu_number, email, password, cgpa, branch)
            VALUES ($1, $2, $3, $4, $5)
        `;
        await pool.query(query, [jntuNumber, email, hashedPassword, cgpa, branch]);

        // Success response
        res.status(201).json({ message: 'Student registered successfully!' });
    } catch (error) {
        console.error('Error saving student:', error);

        // Handle duplicate email or JNTU number
        if (error.code === '23505') { // PostgreSQL unique constraint violation error
            return res.status(400).json({ message: 'Email or JNTU number already exists' });
        }

        // Internal server error response
        res.status(500).json({ message: 'Internal server error' });
    }
});



// cdc signup
app.post('/cdc/register', async (req, res) => {
    const { cdcName, password, cdcId } = req.body;

    // Input validation
    if (!cdcName || !password) {
        return res.status(400).json({ message: 'Admin Name and Password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10); // Hashing the password

        const query = `
            INSERT INTO cdc (admin_name, password${cdcId ? ', admin_id' : ''})
            VALUES ($1, $2${cdcId ? ', $3' : ''})
        `;

        const values = cdcId ? [cdcName, hashedPassword, cdcId] : [cdcName, hashedPassword];

        await pool.query(query, values);

        res.status(201).json({ message: 'CDC registered successfully!' });
    } catch (error) {
        console.error('Error saving CDC:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

//company signup
app.post('/company/register', async (req, res) => {
    const { company_name, company_email, password, required_cgpa_threshold, company_description } = req.body;

    try {
        // Insert the data into the company table
        const result = await pool.query(
            `INSERT INTO company (company_name, company_email, password, required_cgpa_threshold, company_description) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [company_name, company_email, password, required_cgpa_threshold, company_description]
        );

        res.status(201).json({
            message: 'Company registered successfully!',
            companyId: result.rows[0].id, // Return the new company ID
        });
    } catch (error) {
        console.error('Error inserting company data:', error);
        if (error.code === '23505') { // Unique constraint violation
            res.status(400).json({ message: 'Company email already exists!' });
        } else {
            res.status(500).json({ message: 'Failed to register company.' });
        }
    }
});

// cdc company add script 
app.post('/add-company', async (req, res) => {
    const { company_name, cgpa, branch, domain, deadline_date, recruitment_rounds } = req.body;

    console.log('Received Data:', req.body);

    if (!company_name || !cgpa || !branch || !domain || !deadline_date || !recruitment_rounds) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const query = `
            INSERT INTO recruitment_forms (company_name, cgpa, branch, domain, deadline_date, recruitment_rounds)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const values = [company_name, cgpa, branch, domain, deadline_date, recruitment_rounds];

        await pool.query(query, values);

        res.send(`
  <script>
    window.location.href = '/cdc';  
  </script>
`);

    } catch (error) {
        console.error('Error inserting data:', error.message);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
});


// view compkanies
app.get('/companies', async (req, res) => {
    try {
        const query = `
            SELECT id, company_name, cgpa, branch
            FROM recruitment_forms
        `;
        const companies = await pool.query(query);
        res.json(companies.rows);
    } catch (err) {
        console.error('Error fetching companies:', err.message);
        res.status(500).json({ error: 'Failed to fetch company data from the database.' });
    }
});

//delete tables
app.delete('/companies/:id', async (req, res) => {
    const companyId = req.params.id;
    try {
        const query = 'DELETE FROM recruitment_forms WHERE id = $1';
        await pool.query(query, [companyId]);
        res.status(200).json({ message: 'Company deleted successfully.' });
    } catch (err) {
        console.error('Error deleting company:', err.message);
        res.status(500).json({ error: 'Failed to delete the company.' });
    }
});

//eligible students
app.get('/students/eligible', async (req, res) => {
    const { companyId } = req.query;

    try {
        console.log('Received companyId:', companyId);

        // Validate companyId
        const parsedCompanyId = parseInt(companyId, 10);
        if (isNaN(parsedCompanyId)) {
            console.error('Invalid companyId:', companyId);
            return res.status(400).json({ error: 'Invalid companyId format' });
        }

        // Fetch requirements from recruitment_forms table
        const companyResult = await pool.query(
            'SELECT cgpa, branch FROM recruitment_forms WHERE id = $1',
            [parsedCompanyId]
        );

        if (!companyResult.rows.length) {
            console.error('Company not found for ID:', parsedCompanyId);
            return res.status(404).json({ error: 'Company not found' });
        }

        const { cgpa, branch } = companyResult.rows[0];
        console.log('Requirements:', { cgpa, branch });

        // Fetch eligible students from students table
        const studentsResult = await pool.query(
            'SELECT * FROM students WHERE cgpa >= $1 AND branch = $2',
            [cgpa, branch]
        );

        console.log('Eligible students:', studentsResult.rows);

        if (studentsResult.rows.length === 0) {
            console.log('No eligible students found for the given criteria.');
        }

        res.json(studentsResult.rows);
    } catch (error) {
        console.error('Error fetching eligible students:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



//cdc validation

app.post('/cdc-login', async (req, res) => {
    const { adminName, adminPassword } = req.body;

    try {
        // Query to find the admin by name
        const query = `
            SELECT * FROM cdc
            WHERE admin_name = $1
        `;
        const values = [adminName];

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            // Admin not found
            return res.status(401).json({ message: 'Invalid admin name or password' });
        }

        const admin = result.rows[0];

        // Compare the entered password with the hashed password
        const isPasswordValid = await bcrypt.compare(adminPassword, admin.password);

        if (!isPasswordValid) {
            // Password is invalid
            return res.status(401).json({ message: 'Invalid admin name or password' });
        }

        // Password is valid
        res.status(200).json({ message: 'Login successful' });
    } catch (err) {
        console.error('Error during login:', err.message);
        res.status(500).json({ message: 'Server error. Please try again later.' });
    }
});

//student login 

app.post('/student-login', async (req, res) => {
    const { jntu_number, password } = req.body;

    try {
        // Fetch the student record by JNTU number
        const query = `SELECT * FROM students WHERE jntu_number = $1`;
        const result = await pool.query(query, [jntu_number]);

        if (result.rows.length === 0) {
            // If no matching record is found
            return res.status(401).json({ message: 'Invalid JNTU Number or Password' });
        }

        const student = result.rows[0];

        // Compare the provided password with the hashed password in the database
        const isPasswordValid = await bcrypt.compare(password, student.password);
        if (!isPasswordValid) {
            // If the password does not match
            return res.status(401).json({ message: 'Invalid JNTU Number or Password' });
        }

        // Redirect to the jobs page on successful login
        res.redirect('/student');
    } catch (error) {
        // Handle any server errors
        console.error('Error during student login:', error.message);
        res.status(500).json({ message: 'Server error. Please try again later.' });
    }
});



//update company
app.put('/recruitment_forms/:id', async (req, res) => {
    const { id } = req.params;
    const { company_name, cgpa, branch, domain, deadline_date, recruitment_rounds } = req.body;

    try {
        await pool.query(
            `UPDATE recruitment_forms 
             SET company_name = $1, cgpa = $2, branch = $3, domain = $4, deadline_date = $5, recruitment_rounds = $6 
             WHERE id = $7`,
            [company_name, cgpa, branch, domain, deadline_date, recruitment_rounds, id]
        );
        res.status(200).send({ message: 'Company updated successfully.' });
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error updating company.' });
    }
});
app.get('/recruitment_forms', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM recruitment_forms ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching recruitment forms:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


app.get('/cdc', (req, res) => {
    res.render('cdc'); // Assumes 'cdc.ejs' exists in the views folder
});


//delete mocks
app.delete('/deleteMock/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM mocks WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).send('Mock entry not found');
        }
        res.status(200).send('Mock entry deleted successfully');
    } catch (err) {
        console.error('Error deleting mock:', err.message);
        res.status(500).send('Error deleting mock');
    }
});


//getmocks

app.get('/getMocks', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM mocks');
        res.json(result.rows); // Send the fetched data as JSON
    } catch (err) {
        console.error('Error fetching mock data:', err.message);
        res.status(500).send('Error fetching mock data');
    }
});


//addmock
app.post('/addmock', upload.single('companyLogo'), async (req, res) => {
    const { companyName, mockLink, mockDate, duration, durationUnit, companyLogoUrl } = req.body;

    // Use the uploaded file path if no URL is provided
    let companyLogo = req.file ? req.file.path : null;

    // If a URL is provided, use it instead of the file path
    if (companyLogoUrl) {
        companyLogo = companyLogoUrl;
    }

    if (!companyLogo || !companyName || !mockLink || !mockDate || !duration || !durationUnit) {
        return res.status(400).send('All fields are required.');
    }

    try {
        await pool.query(
            `INSERT INTO mocks (company_logo, company_name, mock_link, mock_date, duration, duration_unit)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [companyLogo, companyName, mockLink, mockDate, duration, durationUnit]
        );
        res.redirect('/addmock');
    } catch (err) {
        console.error('Database Error:', err.message);
        res.status(500).send('Database error');
    }
});




app.get('/companies-list', (req, res) => {
    res.render('companies-list');
});

app.get('/student', async (req, res) => {
    try {
        // Query to fetch company details
        const query = `SELECT  id,  company_name,  domain,  branch,  recruitment_rounds  FROM recruitment_forms`;
        const result = await pool.query(query);
        const companies = result.rows;

        // Pass data to the EJS template
        res.render('student', { companies });
    } catch (err) {
        console.error('Error fetching companies:', err);
        res.status(500).send('Error fetching companies');
    }
});

//storing job data
app.post('/submit-application', async (req, res) => {
     console.log("Received form data:", req.body); 
    const {
        company_name,
        name: applicant_name,
        jntu_number,
        cgpa,
        projects: projects_count,
        resume_link
    } = req.body;

    try {
        const query = `
            INSERT INTO job_applications (
                company_name, applicant_name, jntu_number, cgpa, projects_count, resume_link
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const values = [
            company_name,
            applicant_name,
            jntu_number,
            parseFloat(cgpa),
            parseInt(projects_count),
            resume_link
        ];

        await pool.query(query, values);
        res.redirect('/student');  
    } catch (err) {
        console.error('Error inserting application:', err);
        res.status(500).send('Application submission failed.');
    }
});

app.get('/applied_companies', async (req, res) => {
    try {
        // ✅ Updated with correct JNTU number from your DB
        const jntuNumber = '22341A0594';

        const result = await pool.query(`
            SELECT id, company_name AS name, 'Under Review' AS status
            FROM job_applications
            WHERE jntu_number = $1
            ORDER BY application_date DESC
        `, [jntuNumber]);

        const appliedCompanies = result.rows;
        res.render('applied_companies', { appliedCompanies });

    } catch (error) {
        console.error('Error fetching applied companies:', error);
        res.status(500).send('Internal Server Error');
    }
});


app.post('/update-application', async (req, res) => {
    const { id, name, jntu_number, cgpa, projects, resume_link } = req.body;

    try {
        await pool.query(`
            UPDATE job_applications
            SET applicant_name = $1, jntu_number = $2, cgpa = $3, projects_count = $4, resume_link = $5
            WHERE id = $6
        `, [name, jntu_number, cgpa, projects, resume_link, id]);

        res.redirect('/applied_companies');
    } catch (err) {
        console.error('Error updating application:', err);
        res.status(500).send('Internal Server Error');
    }
});
app.post('/withdraw-application', async (req, res) => {
    try {
        const { id } = req.body;
        await pool.query(`DELETE FROM job_applications WHERE id = $1`, [id]);
        res.status(200).send('Deleted');
    } catch (err) {
        console.error('Error withdrawing application:', err);
        res.status(500).send('Internal Server Error');
    }
});




const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
