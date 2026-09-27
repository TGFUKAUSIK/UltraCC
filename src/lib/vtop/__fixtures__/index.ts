/**
 * VTOP HTML fixtures for automated tests.
 *
 * These mirror the structure the parsers were designed against (Spring MVC
 * tables with header rows). They are SYNTHETIC — parser behaviour must be
 * re-confirmed against real authenticated VTOP HTML before anything is marked
 * VERIFIED (see src/lib/vtop/verification.ts).
 */

export const loginPageHtml = `<!doctype html>
<html><head><title>VTOP Login</title></head><body>
<form action="/vtop/processLogin" method="post">
  <input type="hidden" name="_csrf" value="abc123-csrf-token" />
  <label>User Name <input type="text" name="uname" /></label>
  <label>Password <input type="password" name="passwd" /></label>
  <label>Captcha <input type="text" name="captchaCheck" /></label>
  <img src="/vtop/captcha" alt="captcha" />
  <button type="submit">Login</button>
</form>
</body></html>`;

export const attendanceHtml = `<!doctype html>
<html><body>
<h3>Attendance</h3>
<table class="table table-bordered table-striped">
  <thead><tr>
    <th>S.No</th><th>Course Code</th><th>Course Title</th><th>Course Type</th>
    <th>Slot</th><th>Attended</th><th>Total</th><th>Percentage</th><th>Faculty Name</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>A1 + TA1</td><td>28</td><td>32</td><td>87.5%</td><td>Dr. S. K. Vasudevan</td></tr>
    <tr><td>2</td><td>CSE2004</td><td>Database Management Systems</td><td>ETH</td><td>B1 + TB1</td><td>23</td><td>30</td><td>76.6%</td><td>Prof. Anitha R.</td></tr>
    <tr><td>3</td><td>CSE2001L</td><td>Data Structures Lab</td><td>ELA</td><td>L31 + L32</td><td>14</td><td>16</td><td>87.5%</td><td>Dr. S. K. Vasudevan</td></tr>
    <tr><td>4</td><td>MAT2002</td><td>Discrete Mathematics and Graph Theory</td><td>TH</td><td>C1 + TC1</td><td>20</td><td>28</td><td>71.4%</td><td>Dr. P. Sundaram</td></tr>
  </tbody>
  <tfoot><tr><td colspan="9">Overall Attendance Percentage: 80.7%</td></tr></tfoot>
</table>
</body></html>`;

/** Headers re-ordered; attended/total swapped; one percentage missing. */
export const attendanceReorderedHtml = `<!doctype html>
<html><body>
<table class="table">
  <thead><tr>
    <th>Course Code</th><th>Slot</th><th>Total</th><th>Attended</th><th>Percentage</th><th>Course Title</th><th>Course Type</th>
  </tr></thead>
  <tbody>
    <tr><td>CSE2008</td><td>D1 + TD1</td><td>30</td><td>27</td><td>90.0%</td><td>Operating Systems</td><td>ETH</td></tr>
    <tr><td>EEE1001</td><td>E1 + TE1</td><td>30</td><td>25</td><td>—</td><td>Basic Electrical &amp; Electronics</td><td>ETH</td></tr>
  </tbody>
</table>
</body></html>`;

export const attendanceMalformedHtml = `<!doctype html>
<html><body>
<div class="error">No attendance data available for this semester.</div>
</body></html>`;

export const timetableHtml = `<!doctype html>
<html><body>
<table class="table table-bordered">
  <caption>MONDAY</caption>
  <thead><tr><th>Slot</th><th>Course Code</th><th>Course Title</th><th>Venue</th><th>Faculty Name</th></tr></thead>
  <tbody>
    <tr><td>A1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>SJT 204</td><td>Dr. S. K. Vasudevan</td></tr>
    <tr><td>B1</td><td>CSE2004</td><td>Database Management Systems</td><td>SJT 308</td><td>Prof. Anitha R.</td></tr>
    <tr><td>L31 + L32</td><td>CSE2001L</td><td>Data Structures Lab</td><td>Lab Block 201</td><td>Dr. S. K. Vasudevan</td></tr>
  </tbody>
</table>
<table class="table table-bordered">
  <caption>TUESDAY</caption>
  <thead><tr><th>Slot</th><th>Course Code</th><th>Course Title</th><th>Venue</th><th>Faculty Name</th></tr></thead>
  <tbody>
    <tr><td>B1</td><td>CSE2008</td><td>Operating Systems</td><td>SJT 112</td><td>Dr. M. K. Jayanthi</td></tr>
    <tr><td>E1</td><td>EEE1001</td><td>Basic Electrical &amp; Electronics</td><td>AB2 105</td><td>Prof. K. Rajesh</td></tr>
  </tbody>
</table>
</body></html>`;

/** Grid shape: slots as rows, days as columns, multi-line cells. */
export const timetableGridHtml = `<!doctype html>
<html><body>
<table class="table table-bordered">
  <thead><tr><th>Slot</th><th>MON</th><th>TUE</th></tr></thead>
  <tbody>
    <tr><td>A1</td><td>CSE2001<br/>Data Structures and Algorithms<br/>SJT 204<br/>Dr. S. K. Vasudevan</td><td></td></tr>
    <tr><td>D1</td><td></td><td>CSE2008<br/>Operating Systems<br/>SJT 112<br/>Dr. M. K. Jayanthi</td></tr>
  </tbody>
</table>
</body></html>`;

export const timetableMalformedHtml = `<!doctype html>
<html><body><p>No timetable published for this semester.</p></body></html>`;

export const marksHtml = `<!doctype html>
<html><body>
<h3>Internal Assessment Marks</h3>
<table class="table table-bordered">
  <thead><tr>
    <th>S.No</th><th>Course Code</th><th>Course Title</th><th>CAT 1 (50)</th><th>CAT 2 (50)</th>
    <th>DA 1 (10)</th><th>DA 2 (10)</th><th>Quiz (10)</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>42.5</td><td>44</td><td>9.5</td><td>10</td><td>9</td></tr>
    <tr><td>2</td><td>CSE2004</td><td>Database Management Systems</td><td>38</td><td>AB</td><td>9</td><td>8.5</td><td>8</td></tr>
  </tbody>
</table>
</body></html>`;

export const marksMalformedHtml = `<!doctype html>
<html><body><p>Marks will be published after evaluation.</p></body></html>`;

export const examsHtml = `<!doctype html>
<html><body>
<h3>Exam Schedule</h3>
<table class="table table-bordered">
  <thead><tr><th>S.No</th><th>Course Code</th><th>Course Title</th><th>Exam Type</th><th>Date</th><th>Time</th><th>Venue</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>CAT 1</td><td>18-AUG-2026</td><td>10:00 AM - 11:30 AM</td><td>SJT 402</td></tr>
    <tr><td>2</td><td>CSE2004</td><td>Database Management Systems</td><td>CAT 2</td><td>19/08/2026</td><td>02:00 PM - 03:30 PM</td><td>SJT 310</td></tr>
    <tr><td>3</td><td>MAT2002</td><td>Discrete Mathematics and Graph Theory</td><td>FAT</td><td>2026-09-21</td><td>09:00 AM - 12:00 PM</td><td>AB1 205</td></tr>
  </tbody>
</table>
</body></html>`;

export const examsMalformedHtml = `<!doctype html>
<html><body><p>Exam schedule not yet announced.</p></body></html>`;

export const semestersHtml = `<!doctype html>
<html><body>
<select name="semesterSubId">
  <option value="0">-- Select Semester --</option>
  <option value="CH2025261" selected="selected">Winter Semester 2025-26</option>
  <option value="CH2025265">Summer Semester 2026</option>
  <option value="CH2026271">Winter Semester 2026-27</option>
</select>
</body></html>`;

export const semestersMissingHtml = `<!doctype html>
<html><body><p>No active registration.</p></body></html>`;

export const assignmentsHtml = `<!doctype html>
<html><body>
<table class="table table-bordered">
  <thead><tr><th>Course Code</th><th>Assignment Title</th><th>Due Date</th><th>Status</th><th>Weightage</th></tr></thead>
  <tbody>
    <tr><td>CSE2001</td><td>DA 2: Graph Algorithms &amp; MST</td><td>18-AUG-2026</td><td>Pending</td><td>10</td></tr>
    <tr><td>CSE2004</td><td>DA 1: ER Diagrams &amp; SQL</td><td>25-AUG-2026</td><td>Submitted</td><td>10</td></tr>
  </tbody>
</table>
</body></html>`;

export const assignmentsMissingHtml = `<!doctype html>
<html><body><p>No digital assignments currently available.</p></body></html>`;

export const profileHtml = `<!doctype html>
<html><body>
<div class="student-info">
  <h3>Student Dashboard</h3>
  <table class="table">
    <tr><td>Reg No</td><td>23BCE1082</td></tr>
    <tr><td>Student Name</td><td>Kausik</td></tr>
    <tr><td>Program</td><td>B.Tech</td></tr>
    <tr><td>Branch</td><td>Computer Science &amp; Engineering</td></tr>
    <tr><td>School</td><td>SCOPE</td></tr>
    <tr><td>Semester</td><td>4</td></tr>
    <tr><td>CGPA</td><td>8.92</td></tr>
    <tr><td>Proctor Name</td><td>Dr. R. Ramanathan</td></tr>
    <tr><td>Proctor Email</td><td>ramanathan.r@vit.ac.in</td></tr>
    <tr><td>Proctor Mobile</td><td>+91 98765 43210</td></tr>
    <tr><td>Hostel</td><td>MH Block D</td></tr>
    <tr><td>Room No</td><td>D-514</td></tr>
  </table>
</div>
</body></html>`;

export const profileMalformedHtml = `<!doctype html>
<html><body><h3>Error</h3><p>Your session has expired. Please login again.</p></body></html>`;

// ---------------------------------------------------------------------------
// REAL-SHAPE fixtures (current Chennai portal)
//
// These are built from the page structures documented by the MIT-licensed
// VtopMCP client (github.com/Vikranth-jagdish/VtopMCP), which was LIVE-TESTED
// against vtopcc.vit.ac.in. They are REFERENCE-SHAPED — they were NOT captured
// from a real authenticated session, so parser entries stay UNVERIFIED in
// src/lib/vtop/verification.ts until a live pass produces sanitized real HTML.
// ---------------------------------------------------------------------------

/**
 * Attendance with the REAL Chennai structure: the table sits INSIDE
 * <div id="getStudentDetails"> with the full column set (including
 * Registration Date / Attendance Date / View) — live-verified.
 */
export const attendanceRealHtml = `<!doctype html>
<html><body>
<div id="pageData">
  <div id="getStudentDetails">
    <table class="table table-bordered table-striped">
      <tr class="tableHeader"><th>S.No</th><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Slot</th><th>Faculty Name</th><th>Registration Date</th><th>Attendance Date</th><th>Attended</th><th>Total</th><th>Percentage</th><th></th></tr>
      <tr><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>A1+TA1</td><td>Dr. S. K. Vasudevan</td><td>01-AUG-2026</td><td>01-AUG-2026</td><td>28</td><td>32</td><td>87.5</td><td><a onclick="processViewAttendanceDetail('CH202627010062','A1')">View</a></td></tr>
      <tr><td>2</td><td>CSE2004</td><td>Database Management Systems</td><td>ETH</td><td>B1+TB1</td><td>Prof. Anitha R.</td><td>01-AUG-2026</td><td>01-AUG-2026</td><td>23</td><td>30</td><td>76.6</td><td><a onclick="processViewAttendanceDetail('CH202627010063','B1')">View</a></td></tr>
      <tr><td>3</td><td>CSE2001L</td><td>Data Structures Lab</td><td>ELA</td><td>L31+L32</td><td>Dr. S. K. Vasudevan</td><td>01-AUG-2026</td><td>01-AUG-2026</td><td>14</td><td>16</td><td>87.5</td><td><a onclick="processViewAttendanceDetail('CH202627010064','L31')">View</a></td></tr>
    </table>
  </div>
</div>
</body></html>`;

/**
 * Real Chennai timetable course list — table.table with POSITIONAL cells
 * (live-verified): [2] Course Code+Title,
 * [3] L T P J C, [4] Category, [6] Class Id, [7] Slot+Venue, [8] Faculty.
 * Day + time come from the Chennai slot map (A1: Mon 8:00 + Wed 8:55).
 */
export const timetableRealHtml = `<!doctype html>
<html><body>
<table class="table table-bordered table-striped">
  <tr class="tableHeader"><th>S.No</th><th>Class Nbr</th><th>Course</th><th>L T P J C</th><th>Category</th><th>Course Type</th><th>Class Id</th><th>Slot</th><th>Faculty</th></tr>
  <tr><td>1</td><td>1011</td><td>BCSE302L Digital Electronics</td><td>2 0 0 0 4</td><td>PC</td><td>ETH</td><td>CH202627010062</td><td>A1 AB1-205</td><td>Dr. R. Srinivasan</td></tr>
  <tr><td>2</td><td>1012</td><td>BCSE204L Operating Systems</td><td>3 0 0 0 4</td><td>PC</td><td>ETH</td><td>CH202627010063</td><td>D1 AB2-101</td><td>Prof. M. Lakshmi</td></tr>
  <tr><td>3</td><td>1013</td><td>BCSE302P Digital Electronics Lab</td><td>0 0 0 2 1</td><td>PC</td><td>ELA</td><td>CH202627010064</td><td>L31 TT-302</td><td>Dr. R. Srinivasan</td></tr>
</table>
</body></html>`;

/**
 * Real Chennai timetable with a TWO-SLOT lab: the course list serves the lab
 * as one course row with slot string "L31+L32" (two consecutive periods).
 * The parsed timetable must render it as ONE combined session 14:00–15:40,
 * not two independent classes.
 */
export const timetableRealTwoSlotLabHtml = `<!doctype html>
<html><body>
<table class="table table-bordered table-striped">
  <tr class="tableHeader"><th>S.No</th><th>Class Nbr</th><th>Course</th><th>L T P J C</th><th>Category</th><th>Course Type</th><th>Class Id</th><th>Slot</th><th>Faculty</th></tr>
  <tr><td>1</td><td>2011</td><td>BCSE301L Theory of Computation</td><td>3 0 0 0 4</td><td>PC</td><td>ETH</td><td>CH202627010201</td><td>A1 AB1-301</td><td>Dr. A. Theory</td></tr>
  <tr><td>2</td><td>2012</td><td>BCSE302P Digital Electronics Lab</td><td>0 0 0 2 1</td><td>PC</td><td>ELA</td><td>CH202627010202</td><td>L31+L32 TT-302</td><td>Dr. R. Srinivasan</td></tr>
</table>
</body></html>`;

/**
 * Real marks — table.customTable with tr.tableContent course rows, each
 * followed by a nested tr.tableContent holding table.customTable-level1
 * assessment rows with <output> cells (live-verified).
 */
export const marksRealHtml = `<!doctype html>
<html><body>
<div id="pageData">
  <table class="table customTable">
    <tr class="tableHeader"><th>S.No</th><th>Class Nbr</th><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Course System</th><th>Faculty</th><th>Slot</th><th>Course Mode</th></tr>
    <tr class="tableContent"><td>1</td><td>1011</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>Regular</td><td>Dr. S. K. Vasudevan</td><td>A1</td><td>Online</td></tr>
    <tr class="tableContent"><td colspan="9">
      <table class="table customTable-level1">
        <tr class="tableHeader"><th>S.No</th><th>Assessment</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>
        <tr class="tableContent-level1"><td><output>1</output></td><td><output>CAT 1</output></td><td><output>50</output></td><td><output>15</output></td><td><output>Completed</output></td><td><output>42.5</output></td><td><output>12.75</output></td></tr>
        <tr class="tableContent-level1"><td><output>2</output></td><td><output>CAT 2</output></td><td><output>50</output></td><td><output>15</output></td><td><output>Pending</output></td><td><output>AB</output></td><td><output>-</output></td></tr>
        <tr class="tableContent-level1"><td><output>3</output></td><td><output>DA 1</output></td><td><output>10</output></td><td><output>5</output></td><td><output>Completed</output></td><td><output>9.5</output></td><td><output>4.75</output></td></tr>
        <tr class="tableContent-level1"><td><output>4</output></td><td><output>DA 2</output></td><td><output>10</output></td><td><output>5</output></td><td><output>Completed</output></td><td><output>10</output></td><td><output>5</output></td></tr>
        <tr class="tableContent-level1"><td><output>5</output></td><td><output>Quiz</output></td><td><output>10</output></td><td><output>10</output></td><td><output>Completed</output></td><td><output>9</output></td><td><output>9</output></td></tr>
        <tr class="tableContent-level1"><td><output>6</output></td><td><output>FAT</output></td><td><output>100</output></td><td><output>50</output></td><td><output>Pending</output></td><td><output>AB</output></td><td><output>-</output></td></tr>
      </table>
    </td></tr>
    <tr class="tableContent"><td>2</td><td>1012</td><td>CSE2004</td><td>Database Management Systems</td><td>ETH</td><td>Regular</td><td>Prof. Anitha R.</td><td>B1</td><td>Online</td></tr>
    <tr class="tableContent"><td colspan="9">
      <table class="table customTable-level1">
        <tr class="tableHeader"><th>S.No</th><th>Assessment</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>
        <tr class="tableContent-level1"><td><output>1</output></td><td><output>CAT 1</output></td><td><output>50</output></td><td><output>15</output></td><td><output>Completed</output></td><td><output>38</output></td><td><output>11.4</output></td></tr>
        <tr class="tableContent-level1"><td><output>2</output></td><td><output>CAT 2</output></td><td><output>50</output></td><td><output>15</output></td><td><output>Completed</output></td><td><output>44</output></td><td><output>13.2</output></td></tr>
      </table>
    </td></tr>
  </table>
</div>
</body></html>`;

/**
 * Legacy marks shape — div#fixedTableContainer with alternating course rows +
 * nested component tables (kept for the legacy fallback path).
 */
export const marksFixedContainerHtml = `<!doctype html>
<html><body>
<div id="fixedTableContainer">
  <table class="table customTable">
    <tr><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Slot</th></tr>
    <tr><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>A1+TA1</td></tr>
    <tr><td colspan="4">
      <table class="table">
        <tr><th>Title</th><th>Max Marks</th><th>Scored</th><th>Weightage Mark</th><th>%</th><th>Average</th><th>Status</th></tr>
        <tr><td>CAT 1</td><td>50</td><td>42.5</td><td>15</td><td>15</td><td>42.5</td><td>Completed</td></tr>
        <tr><td>CAT 2</td><td>50</td><td>AB</td><td>15</td><td>15</td><td>-</td><td>Pending</td></tr>
        <tr><td>DA 1</td><td>10</td><td>9.5</td><td>5</td><td>5</td><td>9.5</td><td>Completed</td></tr>
        <tr><td>DA 2</td><td>10</td><td>10</td><td>5</td><td>5</td><td>10</td><td>Completed</td></tr>
        <tr><td>Quiz</td><td>10</td><td>9</td><td>10</td><td>10</td><td>9</td><td>Completed</td></tr>
      </table>
    </td></tr>
    <tr><td>CSE2004</td><td>Database Management Systems</td><td>ETH</td><td>B1+TB1</td></tr>
    <tr><td colspan="4">
      <table class="table">
        <tr><th>Title</th><th>Max Marks</th><th>Scored</th><th>Weightage Mark</th><th>%</th><th>Average</th><th>Status</th></tr>
        <tr><td>CAT 1</td><td>50</td><td>38</td><td>15</td><td>15</td><td>38</td><td>Completed</td></tr>
        <tr><td>CAT 2</td><td>50</td><td>44</td><td>15</td><td>15</td><td>44</td><td>Completed</td></tr>
      </table>
    </td></tr>
  </table>
</div>
</body></html>`;

/**
 * Per-semester grade view — /vtop/examinations/examGradeView/doStudentGradeView
 * (live-verified): a
 * table.table-bordered whose first two rows are headers, then an align=center
 * GPA row and course rows with ≥11 cells ([10] grade, [9] grand total, [11]
 * getGradeViewDetails('courseId') button).
 */
export const semesterGradesHtml = `<!doctype html>
<html><body>
<h3 class="box-title"><b>Grade View</b></h3>
<table class="table table-bordered">
  <tr class="tableHeader"><th colspan="12">Winter Semester 2025-26</th></tr>
  <tr class="tableHeader"><th>S.No</th><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Credits</th><th>Internal</th><th>CAT1</th><th>CAT2</th><th>DA</th><th>Total</th><th>Grade</th><th></th></tr>
  <tr align="center"><td colspan="12">GPA : 8.92</td></tr>
  <tr><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>4</td><td>-</td><td>-</td><td>-</td><td>-</td><td>88</td><td>A</td><td><button onclick="javascript:getGradeViewDetails('CH202526010062')">View</button></td></tr>
  <tr><td>2</td><td>CSE2004</td><td>Database Management Systems</td><td>ETH</td><td>4</td><td>-</td><td>-</td><td>-</td><td>-</td><td>86</td><td>A</td><td><button onclick="javascript:getGradeViewDetails('CH202526010063')">View</button></td></tr>
  <tr><td>3</td><td>MAT2002</td><td>Discrete Mathematics and Graph Theory</td><td>TH</td><td>4</td><td>-</td><td>-</td><td>-</td><td>-</td><td>91</td><td>S</td><td><button onclick="javascript:getGradeViewDetails('CH202526010064')">View</button></td></tr>
</table>
</body></html>`;

/**
 * Cumulative grade history — /vtop/examinations/examGradeView/StudentGradeHistory
 * (live-verified): a CGPA
 * summary table (Credits/CGPA headers), a grade-counts row in
 * table.table-hover (tds[3..10] = S/A/B/C/D/E/F/N), and an effective-grades
 * table inside #fixedTableContainer.
 */
export const gradeHistoryHtml = `<!doctype html>
<html><body>
<h3 class="box-title"><b>Grade History</b></h3>
<div id="fixedTableContainer">
  <table class="table table-bordered">
    <tr class="tableHeader"><th>S.No</th><th></th><th>Course Title</th><th>Course Type</th><th>Credits Earned</th><th>Grade</th><th></th><th></th><th>Distribution Type</th></tr>
    <tr class="tableContent"><td>1</td><td></td><td>Data Structures and Algorithms</td><td>ETH</td><td>4</td><td>A</td><td></td><td></td><td>Core</td></tr>
    <tr class="tableContent"><td>2</td><td></td><td>Database Management Systems</td><td>ETH</td><td>4</td><td>A</td><td></td><td></td><td>Core</td></tr>
    <tr class="tableContent"><td>3</td><td></td><td>Discrete Mathematics and Graph Theory</td><td>TH</td><td>4</td><td>S</td><td></td><td></td><td>Core</td></tr>
    <tr class="tableContent"><td>4</td><td></td><td>Data Structures Lab</td><td>ELA</td><td>1</td><td>S</td><td></td><td></td><td>Lab</td></tr>
  </table>
</div>
<table class="table table-hover table-bordered">
  <tr><td>Grade</td><td></td><td></td><td>S</td><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td><td>F</td><td>N</td></tr>
  <tr><td>Count</td><td></td><td></td><td>10</td><td>8</td><td>5</td><td>2</td><td>1</td><td>0</td><td>0</td><td>0</td></tr>
</table>
<table class="table table-bordered">
  <tr><th>Credits Registered</th><th>Credits Earned</th><th>CGPA</th></tr>
  <tr><td>172</td><td>120</td><td>8.92</td></tr>
</table>
</body></html>`;

/**
 * Real Chennai exam schedule — table.customTable with POSITIONAL cells
 * (live-verified): [1] Course Code,
 * [2] Course Title, [4] Class Id, [5] Slot, [6] Exam Date, [7] Session,
 * [8] Reporting Time, [9] Exam Time, [10] Venue, [11] Seat Location,
 * [12] Seat No; rows grouped under a single-cell colspan=13 exam-type row.
 */
export const examsRealHtml = `<!doctype html>
<html><body>
<table class="table customTable table-bordered">
  <tr class="tableHeader"><th>S.No</th><th>Course Code</th><th>Course Title</th><th>Class Type</th><th>Class Id</th><th>Slot</th><th>Exam Date</th><th>Session</th><th>Reporting Time</th><th>Exam Time</th><th>Venue</th><th>Seat Location</th><th>Seat No</th></tr>
  <tr><td colspan="13">CAT 1</td></tr>
  <tr class="tableContent"><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>CH202627010062</td><td>A1</td><td>18-Aug-2026</td><td>AN</td><td>09:15 AM</td><td>10:00 AM - 11:30 AM</td><td>AB1-402</td><td>AB1</td><td>B-12</td></tr>
  <tr class="tableContent"><td>2</td><td>CSE2004</td><td>Database Management Systems</td><td>ETH</td><td>CH202627010063</td><td>D1</td><td>20-Aug-2026</td><td>AN</td><td>09:15 AM</td><td>10:00 AM - 11:30 AM</td><td>AB2-310</td><td>AB2</td><td>C-04</td></tr>
  <tr><td colspan="13">FAT EXAM</td></tr>
  <tr class="tableContent"><td>3</td><td>BCSE302L</td><td>Digital Electronics</td><td>ETH</td><td>CH202627010062</td><td>A1</td><td>21-Sep-2026</td><td>FN</td><td>08:30 AM</td><td>09:00 AM - 12:00 PM</td><td>SJT-402</td><td>SJT</td><td>A-27</td></tr>
</table>
</body></html>`;

/**
 * Real CHENNAI exam schedule shape (live-tested via VtopMCP): the page has NO
 * course-code / course-title column. Columns are Slot | Exam Date | Session |
 * Reporting Time | Exam Time | Venue | Seat Location | Seat No, grouped under
 * a full-width "CAT 1" / "FAT EXAM" section row. Course codes/titles are
 * enriched from the same-semester timetable by slot on the client.
 */
export const examsChennaiNoCodeHtml = `<!doctype html>
<html><body>
<table class="table customTable table-bordered">
  <tr class="tableHeader"><th>S.No</th><th>Slot</th><th>Exam Date</th><th>Session</th><th>Reporting Time</th><th>Exam Time</th><th>Venue</th><th>Seat Location</th><th>Seat No</th></tr>
  <tr><td colspan="9">CAT 1</td></tr>
  <tr class="tableContent"><td>1</td><td>A1</td><td>18-Aug-2026</td><td>AN</td><td>09:15 AM</td><td>10:00 AM - 11:30 AM</td><td>AB1-402</td><td>AB1</td><td>B-12</td></tr>
  <tr class="tableContent"><td>2</td><td>D1</td><td>20-Aug-2026</td><td>AN</td><td>09:15 AM</td><td>10:00 AM - 11:30 AM</td><td>AB2-310</td><td>AB2</td><td>C-04</td></tr>
  <tr><td colspan="9">FAT EXAM</td></tr>
  <tr class="tableContent"><td>3</td><td>A1</td><td>21-Sep-2026</td><td>FN</td><td>08:30 AM</td><td>09:00 AM - 12:00 PM</td><td>SJT-402</td><td>SJT</td><td>A-27</td></tr>
</table>
</body></html>`;

/** Real profile: hidden regno input + label/value pairs. */
/**
 * Real CGPA/credits — /vtop/get/dashboard/current/cgpa/credits returns
 * .list-group-item rows with a span.card-title label and a span.fontcolor3
 * value (live-verified).
 */
export const cgpaCreditsHtml = `<!doctype html>
<html><body>
<div class="list-group">
  <div class="list-group-item"><span class="card-title">Total Credits Required</span><span class="fontcolor3"><span>172</span></span></div>
  <div class="list-group-item"><span class="card-title">Earned Credits</span><span class="fontcolor3"><span>78</span></span></div>
  <div class="list-group-item"><span class="card-title">Current CGPA</span><span class="fontcolor3"><span>8.92</span></span></div>
  <div class="list-group-item"><span class="card-title">Non-graded Core Requirement</span><span class="fontcolor3"><span>0</span></span></div>
</div>
</body></html>`;

/** Real proctor details — /vtop/proctor/viewProctorDetails (label/value table). */
export const proctorHtml = `<!doctype html>
<html><body>
<h3 class="box-title"><b>Proctor Details</b></h3>
<table class="table table-bordered">
  <tr><td>Faculty Name</td><td>Dr. R. Ramanathan</td></tr>
  <tr><td>Faculty Email</td><td>r.ramanathan@vit.ac.in</td></tr>
  <tr><td>Faculty Mobile</td><td>9876501234</td></tr>
  <tr><td>Faculty Designation</td><td>Associate Professor</td></tr>
</table>
</body></html>`;

export const profileRealHtml = `<!doctype html>
<html><body>
<input type="hidden" name="regno" value="23BCE1082" />
<div id="profileTable">
  <table class="table">
    <tr><td>Student Name</td><td>Kausik R</td></tr>
    <tr><td>Application Number</td><td>AP2024123456</td></tr>
    <tr><td>Programme</td><td>UG</td></tr>
    <tr><td>Branch / Group Studied</td><td>PCM</td></tr>
    <tr><td>School</td><td>SCOPE</td></tr>
    <tr><td>Email</td><td>kausik.r2023@vitstudent.ac.in</td></tr>
    <tr><td>Mobile Number</td><td>9876543210</td></tr>
    <tr><td>Blood Group</td><td>O+</td></tr>
    <tr><td>Proctor Name</td><td>Dr. R. Ramanathan</td></tr>
    <tr><td>Proctor Email</td><td>r.ramanathan@vit.ac.in</td></tr>
    <tr><td>Proctor Mobile</td><td>9445500123</td></tr>
  </table>
</div>
</body></html>`;
