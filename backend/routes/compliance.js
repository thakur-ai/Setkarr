const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// @route   GET api/compliance/guidelines
// @desc    Get legal compliance guidelines
// @access  Private
router.get('/guidelines', auth, async (req, res) => {
  try {
    // In a real application, these guidelines would be fetched from a database
    // or a dedicated content management system.
    const complianceGuidelines = {
      title: "Barber Shop Legal Compliance Guidelines (India)",
      lastUpdated: "2025-11-16",
      sections: [
        {
          heading: "Business Registration",
          content: "Ensure your barber shop is registered under the Shops and Establishments Act or as a proprietorship/partnership/company as per Indian law. Obtain all necessary local licenses and permits."
        },
        {
          heading: "Health and Safety Regulations",
          content: "Adhere to local health department regulations regarding hygiene, sanitation, disposal of sharp instruments, and use of sterilized equipment. Regular inspections may occur."
        },
        {
          heading: "GST Compliance",
          content: "Register for GST if your annual turnover exceeds the threshold. Issue GST-compliant invoices for all taxable services. File GST returns (GSTR-1, GSTR-3B, etc.) accurately and on time. Maintain proper records of sales and purchases."
        },
        {
          heading: "Consumer Protection",
          content: "Comply with the Consumer Protection Act. Clearly display service charges, refund policies, and address customer grievances promptly."
        },
        {
          heading: "Employee Regulations",
          content: "Adhere to labor laws regarding minimum wage, working hours, provident fund (PF), Employees' State Insurance (ESI) if applicable, and provide a safe working environment."
        },
        {
          heading: "Data Privacy",
          content: "If collecting customer data (e.g., names, phone numbers), ensure compliance with data protection principles. Obtain consent where necessary and protect customer information."
        }
      ],
      disclaimer: "This information is for general guidance only and does not constitute legal advice. Please consult with a legal professional for specific advice regarding your business."
    };

    res.json(complianceGuidelines);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
